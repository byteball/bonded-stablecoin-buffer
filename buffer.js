/*jslint node: true */
"use strict";

const ValidationUtils = require('ocore/validation_utils.js');
const eventBus = require('ocore/event_bus.js');
const db = require('ocore/db.js');
const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex.js');
const objectHash = require("ocore/object_hash.js");
const aa_addresses = require("ocore/aa_addresses.js");

const operator = require('aabot/operator.js');
const dag = require('aabot/dag.js');
const CurveAA = require('./curve.js');
const aa_state = require('aabot/aa_state.js');
const orders = require('./orders.js');

let curves = {};
let curvesByArb = {};

async function addCurve(curve_aa) {
	const unlock = await mutex.lock(curve_aa);
	if (curves[curve_aa])
		return unlock();
	const curveAA = await CurveAA.create(curve_aa);
	curves[curve_aa] = curveAA;
	eventBus.on('aa_request_applied-' + curve_aa, () => {
		console.log(`new request to the curve ${curve_aa}, will awake the pending buffers`);
		triggerPendingBuffers(curve_aa);
	});
	unlock();
}

function getDefinition(address, curve_aa) {
	return ["autonomous agent", {
		base_aa: conf.buffer_base_aa,
		params: {
			address: address,
			curve_aa: curve_aa,
		}
	}];
}

async function getOrCreateBufferAddress(address, curve_aa) {
	const rows = await db.query("SELECT buffer_address, definition FROM buffer_addresses WHERE address=? AND curve_aa=?", [address, curve_aa]);
	const row = rows[0];
	if (row) {
		await db.query("UPDATE buffer_addresses SET in_work=1, last_update_date=" + db.getNow() + " WHERE buffer_address=?", [row.buffer_address]);
		row.definition = JSON.parse(row.definition);
		await addCurve(curve_aa);
		await aa_state.followAA(row.buffer_address);
		return row;
	}
	const definition = getDefinition(address, curve_aa);
	const buffer_address = objectHash.getChash160(definition);
	const unit = await dag.defineAA(definition);
	if (!unit)
		throw Error("failed to define new AA");
	await db.query(
		`INSERT ${db.getIgnore()} 
		INTO buffer_addresses (buffer_address, address, curve_aa, definition, in_work, last_update_date)
		VALUES (?, ?, ?, ?, 1, ${db.getNow()})`,
		[buffer_address, address, curve_aa, JSON.stringify(definition)]
	);
	await addCurve(curve_aa);
	await aa_state.followAA(buffer_address);
	return { buffer_address, definition };
}

// returns an error, null otherwise
async function validateCurveAA(curve_aa) {
	if (!ValidationUtils.isValidAddress(curve_aa))
		return "bad curve address";
	const rows = await aa_addresses.readAADefinitions([curve_aa]);
	const row = rows[0];
	if (!row)
		return "not an AA";
	if (row.base_aa !== conf.curve_base_aa)
		return "wrong AA";
	const params = JSON.parse(row.definition)[1].params;
	const reserve_asset = params.reserve_asset || 'base';
	if (reserve_asset !== 'base')
		return "reserve asset is not bytes";
	return null;
}

async function getBuffer(buffer_address) {
	return (await db.query("SELECT * FROM buffer_addresses WHERE buffer_address=?", [buffer_address]))[0];
}

async function triggerPendingBuffers(curve_aa) {
	const unlock = await mutex.lock("recheck");
	console.log("==== looking for non-executed mints on " + (curve_aa || "all curves"));
	const rows = await db.query("SELECT buffer_address, curve_aa, definition, strftime('%s', creation_date) AS creation_ts FROM buffer_addresses WHERE in_work=1" + (curve_aa ? " AND curve_aa=" + db.escape(curve_aa) : ""));
	console.log(`found ${rows.length} unexecuted mints`);
	for (let row of rows) {
		const unlock = await aa_state.lock();
		let balancesByAsset = aa_state.getUpcomingBalances()[row.buffer_address];
		if (!balancesByAsset) {
			console.log(`triggerPendingBuffers: balances of ${row.buffer_address} not known yet`);
			balancesByAsset = await dag.readAABalances(row.buffer_address);
			aa_state.addBalances(row.buffer_address, balancesByAsset);
		}
		unlock();
		let balance = balancesByAsset.base || 0;
		if (balance <= 1e5 && row.creation_ts < Date.now() / 1000 - 24 * 3600) {
			console.log(`${row.buffer_address} balance left is too low (${balance}), will stop checking it`);
			await db.query("UPDATE buffer_addresses SET in_work=0 WHERE buffer_address=?", [row.buffer_address]);
			continue;
		}
		console.log(`retrying ${row.buffer_address}: ${balance} bytes`);
		await executePurchase(row.buffer_address, balance, row.curve_aa, JSON.parse(row.definition));
	}
	unlock();
}

async function executePurchase(buffer_address, balance, curve_aa, arrDefinition) {
	const params = arrDefinition[1].params;
	const curveAA = curves[curve_aa];
	if (!curveAA)
		throw Error(`no class for curve ${curve_aa}`);
	const tokens2 = await curveAA.get_tokens2_amount(balance - 1000, params.max_fee_percent || 1);
	if (tokens2 === 0)
		return console.log("would receive 0 tokens2");
	const unit = await dag.sendAARequest(buffer_address, { execute: 1, tokens2 });
	if (!unit)
		return console.log("failed to send AA request to " + buffer_address);
	const objJoint = await dag.readJoint(unit);
	// upcoming state vars are updated and the next purchase attempt will see them
	console.log(`executePurchase: calling onAARequest manually`);
	aa_state.onAARequest({ unit: objJoint.unit, aa_address: buffer_address });
}

async function onAAResponse(objAAResponse) {
//	console.log(`buffer: AA response:`, JSON.stringify(objAAResponse, null, '\t'));
	console.log(`buffer: AA response:`, objAAResponse);
	const aa_address = objAAResponse.aa_address;
	const buffer = await getBuffer(aa_address);
	if (!buffer) {
		console.log(`response from a non-buffer AA ${aa_address}`);
		if (!curves[aa_address])
			return console.log(`response from AA ${aa_address} that is neither buffer nor tracked curve`);
		const curve_aa = aa_address;
		console.log(`response from curve AA ${curve_aa}`);
		await triggerPendingBuffers(curve_aa);
		return;
	}
	const buffer_address = aa_address;
	if (objAAResponse.bounced)
		return console.log(`${buffer_address} bounced with error ${objAAResponse.response.error}`);
	const responseVars = objAAResponse.response.responseVars;
	if (!responseVars) {
		if (!buffer.in_work && objAAResponse.trigger_address !== operator.getAddress())
			await db.query("UPDATE buffer_addresses SET in_work=1 WHERE buffer_address=?", [buffer_address]);
		return console.log('no response vars');
	}
	if (responseVars.message === 'Done') {
		console.log(`${buffer_address} is done`);
		await db.query("UPDATE buffer_addresses SET in_work=0 WHERE buffer_address=?", [buffer_address]);
		// see if we need to pay a welcome reward to this user to make sure he has some bytes for fees
		const balances = await dag.readBalance(buffer.address);
		const byte_balance = balances.base ? balances.base.total : 0;
		if (byte_balance > 0)
			return console.log(`${buffer.address} already has some bytes`);
		const rows = await db.query("SELECT 1 FROM outputs LEFT JOIN unit_authors USING(unit) WHERE outputs.address=? AND unit_authors.address=? AND asset IS NULL", [buffer.address, operator.getAddress()]);
		if (rows.length > 0)
			return console.log(`already paid welcome reward to ${buffer.address}`);
		const unit = await dag.sendPayment({ to_address: buffer.address, amount: conf.welcomeBytesAmount });
		console.log(`paid welcome reward to ${buffer.address}: ${unit}`);
	}
}

async function onAARequest(objAARequest) {
//	console.log(`buffer: AA request:`, JSON.stringify(objAARequest, null, '\t'));
	console.log(`buffer: AA request:`, objAARequest);
	if (objAARequest.unit.authors[0].address === operator.getAddress())
		return console.log(`skipping our own request`);
	const aa_address = objAARequest.aa_address;
	const objUnit = objAARequest.unit;
	const buffer = await getBuffer(aa_address);
	if (!buffer) {
		console.log(`request to a non-buffer AA ${aa_address}`);
		let curve_aa;
		if (curves[aa_address]) {
			curve_aa = aa_address;
			console.log(`request to curve AA ${curve_aa}`);
		}
		else if (curvesByArb[aa_address]) {
			curve_aa = curvesByArb[aa_address];
			console.log(`request to arb AA ${aa_address} on curve ${curve_aa}`);
		}
		else
			return console.log(`request to unrecognized AA ${aa_address}`);
		await triggerPendingBuffers(curve_aa);
		return;
	}
	const buffer_address = aa_address;
	let objMessage = objUnit.messages.find(message => message.app === 'payment' && !message.payload.asset);
	if (!objMessage)
		return console.log(`no bytes payment to AA ${buffer_address}`);
	let output = objMessage.payload.outputs.find(output => output.address === buffer_address);
	if (!output)
		return console.log(`no output to our AA ${buffer_address}`);
	const amount = output.amount;
	if (amount === 1e4)
		return console.log(`skipping execute request to buffer ${buffer_address}`);
	// from now on, it is a refill of the buffer
	await orders.finishOrders(buffer_address);
	const unlock = await aa_state.lock();
	let upcomingBalances = aa_state.getUpcomingBalances()[buffer_address];
	console.log('upcomingBalances on', buffer_address, upcomingBalances);
	if (!upcomingBalances)
		throw Error(`no upcoming balances on buffer ${buffer_address}?`);
	let balance = upcomingBalances.base || 0;
	unlock();
	if (balance < 1e5)
		return console.log(`balance of ${buffer_address} is too low: ${balance}`);
	if (!buffer.in_work)
		await db.query("UPDATE buffer_addresses SET in_work=1 WHERE buffer_address=?", [buffer_address]);
	await executePurchase(buffer_address, balance, buffer.curve_aa, JSON.parse(buffer.definition));
}



async function startWatching() {
	await aa_addresses.readAADefinitions([conf.curve_base_aa]);
	await aa_addresses.readAADefinitions([conf.buffer_base_aa]);
	await aa_addresses.readAADefinitions([conf.arb_base_aa]);
	
	eventBus.on("aa_request_applied", onAARequest);
	eventBus.on("aa_response_applied", onAAResponse);
	
	// watch buffer AAs
	const buffer_rows = await db.query(`SELECT buffer_address, curve_aa FROM buffer_addresses WHERE in_work=1`);
	for (let row of buffer_rows) {
		await addCurve(row.curve_aa);
		await aa_state.followAA(row.buffer_address);
	};

	// watch arb AAs
	const arb_rows = await dag.getAAsByBaseAAs(conf.arb_base_aa);
	for (let row of arb_rows) {
		const curve_aa = row.definition[1].params.curve_aa;
		if (!curves[curve_aa]) // not on any of our curves?
			await addCurve(curve_aa);
		curvesByArb[row.address] = curve_aa;
		console.log(`will watch arb AA ${row.address}`);
		await aa_state.followAA(row.address);
	}

	eventBus.on('data_feeds_updated', triggerPendingBuffers);
	setInterval(orders.finishOrders, 5 * 60 * 1000);
	setInterval(orders.payCompensations, 11 * 60 * 1000 + 13);
	await triggerPendingBuffers();
}

exports.getOrCreateBufferAddress = getOrCreateBufferAddress;
exports.validateCurveAA = validateCurveAA;
exports.getBuffer = getBuffer;
exports.startWatching = startWatching;
