/*jslint node: true */
"use strict";

const db = require('ocore/db.js');
const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex.js');
const simpleswap = require('./simpleswap.js');
const oswapcc = require('./oswapcc.js');
const cryptocompare = require('./cryptocompare.js');
const dag = require('aabot/dag.js');

async function getExpectedCompensation(amount_in, currency_in, amount_out) {
	let is_eligible = await isEligible();
	if (!is_eligible)
		return { eligible: false };
	let { compensation } = await getFeeAndCompensation(parseFloat(amount_in), currency_in.toUpperCase(), parseFloat(amount_out));
	return { eligible: true, compensation };
}

function addFields(provider, order_info) {
	if (provider === 'oswapcc') {
		order_info.address_to = order_info.out_address;
		order_info.currency_from = order_info.in_coin;
		order_info.amount_from = order_info.in_amount;
		order_info.amount_to = order_info.expected_out_amount;
	}
}

function isFinished(provider, order_info) {
	if (provider === 'simpleswap')
		return (order_info.status === 'finished' || order_info.status === 'sending');
	if (provider === 'oswapcc')
		return (order_info.status === 'sent');
	throw Error(`unknown provider ` + provider);
}

async function createOrder(order) {
	let is_eligible = (await isEligible()) ? 1 : 0;
	let provider_api;
	if (order.provider === 'simpleswap')
		provider_api = simpleswap;
	else if (order.provider === 'oswapcc')
		provider_api = oswapcc;
	else
		throw Error("wrong provider: " + order.provider);
	order.currency_in = order.currency_in.toUpperCase();
	let order_info = await provider_api.fetchExchangeInfo(order.provider_id);
	addFields(order.provider, order_info);
	if (order.buffer_address !== order_info.address_to)
		throw Error(`dest address doesn't match ${order.buffer_address} !== ${order_info.address_to}`); 
	if (order.currency_in !== order_info.currency_from.toUpperCase())
		throw Error(`input currency doesn't match ${order.currency_in} !== ${order_info.currency_from}`); 
	if (order.provider !== 'oswapcc' && order.amount_in.toString() !== order_info.amount_from)
		throw Error(`input amount doesn't match ${order.amount_in} !== ${order_info.amount_from}`); 
	if (order.expected_amount_out.toString() !== order_info.amount_to)
		throw Error(`output amount doesn't match ${order.expected_amount_out} !== ${order_info.amount_to}`);
	let { fee, compensation } = await getFeeAndCompensation(parseFloat(order.amount_in), order.currency_in, parseFloat(order.expected_amount_out));
	if (!is_eligible)
		compensation = null;
	await db.query(
		`INSERT ${db.getIgnore()} 
		INTO orders (provider, provider_id, buffer_address, amount_in, currency_in, expected_amount_out, expected_compensation, expected_fee, is_eligible)
		VALUES (?,?, ?, ?,?, ?,?,?, ?)`,
		[order.provider, order.provider_id, order.buffer_address, order.amount_in, order.currency_in, order.expected_amount_out, compensation, fee, is_eligible]
	);
}

async function finishOrders(buffer_address) {
	const orders = await db.query("SELECT * FROM orders WHERE provider IN('simpleswap', 'oswapcc') AND is_done=0 " + (buffer_address ? "AND buffer_address=" + db.escape(buffer_address) : ""));
	let count = 0;
	for (let order of orders) {
		let provider_api;
		if (order.provider === 'simpleswap')
			provider_api = simpleswap;
		else if (order.provider === 'oswapcc')
			provider_api = oswapcc;
		else
			throw Error("wrong provider: " + order.provider);
		let order_info;
		try {
			order_info = await provider_api.fetchExchangeInfo(order.provider_id);
		}
		catch (e) {
			console.log(`fetching order ${order.provider_id} failed`, e);
			continue;
		}
		addFields(order.provider, order_info);
		if (!isFinished(order.provider, order_info))
			continue;
		order_info.amount_from = parseFloat(order_info.amount_from);
		order_info.amount_to = parseFloat(order_info.amount_to);
		if (Math.abs(order_info.amount_from - order.amount_in)/order.amount_in > 0.001) {
			console.log(`order ${order.order_id} amount_in updated from ${order.amount_in} to ${order_info.amount_from}`);
			order.amount_in = order_info.amount_from;
			await db.query("UPDATE orders SET amount_in=? WHERE order_id=?", [order_info.amount_from, order.order_id]);
		}
		let { fee, compensation } = await getFeeAndCompensation(order.amount_in, order.currency_in, order_info.amount_to);
		if (!order.is_eligible)
			compensation = null;
		else if (Math.floor(compensation * 1e9) === 0)
			compensation = 0;
		console.log(`fee paid in order ${order.order_id} that exchanged ${order.amount_in} ${order.currency_in}: ${fee}%, compensation ${compensation} GB`);
		const is_compensated = (order.is_eligible && compensation === 0) ? 1 : 0;
		await db.query("UPDATE orders SET is_done=1, amount_out=?, fee=?, compensation=?, is_compensated=? WHERE order_id=?", [order_info.amount_to, fee, compensation, is_compensated, order.order_id]);
		count++;
	}
	if (count)
		await payCompensations();
}

async function payCompensations() {
	const unlock = await mutex.lock('payCompensations');
	const orders = await db.query("SELECT orders.*, address, in_work FROM orders LEFT JOIN buffer_addresses USING(buffer_address) WHERE provider IN('simpleswap', 'oswapcc') AND is_done=1 AND is_eligible=1 AND is_compensated=0");
	for (let order of orders) {
		const compensation_amount_in_bytes = Math.floor(order.compensation * 1e9);
		const unit = await dag.sendPayment({ to_address: order.buffer_address, amount: compensation_amount_in_bytes });
		if (unit) {
			console.log(`sent ${order.compensation} GB compensation to user ${order.address} buffer ${order.buffer_address} for order ${order.order_id}`);
			await db.query("UPDATE orders SET is_compensated=1, compensation_unit=?, compensation_date=" + db.getNow() + " WHERE order_id=?", [unit, order.order_id]);
			if (!order.in_work)
				await db.query("UPDATE buffer_addresses SET in_work=1 WHERE buffer_address=?", [order.buffer_address]);
		}
		else
			console.log(`failed to send ${order.compensation} GB compensation to user ${order.address} buffer ${order.buffer_address} for order ${order.order_id}`);
	}
	unlock();
}

// returns fee as %
async function getFeeAndCompensation(amount_in, currency_in, amount_out) {
	const fair_rate = await cryptocompare.fetchExchangeRate(currency_in);
	const fair_amount_out = fair_rate * amount_in;
	const fee = (fair_amount_out - amount_out) / fair_amount_out * 100;
	let compensation = 0;
	if (fee <= 0)
		return { fee, compensation };
	const target_amount_out = fair_amount_out * (1 - conf.target_fee / 100);
	if (amount_out >= target_amount_out)
		return { fee, compensation };
	compensation = Math.min(target_amount_out - amount_out, amount_out * conf.max_compensation / 100);
	return { fee, compensation };
}

async function isEligible() {
	const rows = await db.query("SELECT SUM(expected_compensation) AS total FROM orders WHERE creation_date >= date('now')");
	const total = rows[0].total || 0;
	return (total < conf.daily_compensation_quota);
}



exports.getExpectedCompensation = getExpectedCompensation;
exports.createOrder = createOrder;
exports.finishOrders = finishOrders;
exports.payCompensations = payCompensations;
