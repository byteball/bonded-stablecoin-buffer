/*jslint node: true */
"use strict";

const conf = require('ocore/conf.js');
const network = require('ocore/network.js');
const eventBus = require('ocore/event_bus.js');
const aa_state = require('aabot/aa_state.js');
const dag = require('aabot/dag.js');
const CurveAA = require('./curve.js');

const _ = require('lodash');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;

let wss;
let state;
let watched_aas = [];

async function getCurrentState() {
	return state || await getStateSnapshot();
}

async function getStateSnapshot() {
	let state = { upcomingStateVars: {}, upcomingBalances: {} };
	const unlock = await aa_state.lock();
	for (let aa of watched_aas) { // we are interested in only a subset of the state
		state.upcomingStateVars[aa] = aa_state.getUpcomingAAStateVars(aa);
		state.upcomingBalances[aa] = _.clone(aa_state.getUpcomingBalances()[aa]);
	}
	unlock();
	return state;	
}

function diff(old_o, new_o) {
	let d = {};
	for (let aa in new_o) {
		if (!old_o[aa] || !_.isEqual(old_o[aa], new_o[aa]))
			d[aa] = new_o[aa];
	}
	return d;
}

async function updateState() {
	let new_state = await getStateSnapshot();
	let update = {
		upcomingStateVars: diff(state.upcomingStateVars, new_state.upcomingStateVars),
		upcomingBalances: diff(state.upcomingBalances, new_state.upcomingBalances),
	};
	state = new_state;
	if (Object.keys(update.upcomingStateVars).length === 0 && Object.keys(update.upcomingBalances).length === 0)
		return console.log("no changes");
	broadcastUpcomingStateUpdate(update);
}

function broadcastUpcomingStateUpdate(update) {
	for (let ws of wss.clients)
		sendMessage(ws, { update });
}

function sendMessage(ws, obj) {
	var message = JSON.stringify(obj);
	if (ws.readyState !== ws.OPEN)
		return console.log("readyState=" + ws.readyState + ' on peer ' + ws.peer + ', will not send ' + message);
	console.log("SENDING " + message + " to " + ws.peer);
	ws.send(message, function(err){
		if (err)
			ws.emit('error', 'From send: ' + err);
	});
}

function startWebsocketServer() {
	wss = new WebSocketServer({ port: conf.wsPort });
	wss.on('connection', async function(ws) {
		let ip = ws.upgradeReq.connection.remoteAddress;
		if (!ip){
			console.log("no ip in accepted connection");
			ws.terminate();
			return;
		}
		console.log('new websocket connect with headers', ws.upgradeReq.headers);
		if (ip === '127.0.0.1' || ip.match(/^192\.168\./) || ip.match(/^10\./)) { // we are behind a proxy
			if (ws.upgradeReq.headers['x-forwarded-for'])
				ip = ws.upgradeReq.headers['x-forwarded-for'].split(', ')[0];
			else if (ws.upgradeReq.headers['x-real-ip'])
				ip = ws.upgradeReq.headers['x-real-ip'];
		}
		ws.peer = ip + ":" + ws.upgradeReq.connection.remotePort;
		console.log('got connection from ' + ws.peer);
		if (wss.clients.length >= conf.MAX_STATE_CONNECTIONS){
			console.log("inbound connections maxed out, rejecting new client " + ws.peer);
			ws.close(1000, "inbound connections maxed out"); // 1001 doesn't work in cordova
			return;
		}
		ws.on('close', function(){
			console.log("client " + ws.peer + " disconnected");
		});
		ws.on('error', function(e){
			console.log("error on client " + ws.peer + ": " + e);
			ws.close(1000, "received error");
		});
		sendMessage(ws, { snapshot: state });
	});
	console.log('state WSS running at port ' + conf.wsPort);
}

async function addWatchedAA(aa) {
	if (watched_aas.includes(aa)) // already watching it
		return;
	watched_aas.push(aa);
	if (state) // initialized
		await updateState();
}

async function onAARequest(objAARequest) {
	console.log(`state onAARequest:`, objAARequest);
	await updateState();
}

async function onAAResponse(objAAResponse) {
	console.log(`state onAAResponse:`, objAAResponse);
}

async function startWatching() {
	// watch all curve AAs
	const curve_rows = await dag.getAAsByBaseAAs(conf.curve_base_aas);
	for (let row of curve_rows) {
		console.log(`will watch curve AA ${row.address}`);
		await CurveAA.create(row.address);
		watched_aas.push(row.address);
	}

	// watch all governance, deposit, stable, SF, and DE AAs
	let base_aas = conf.governance_base_aas.concat([conf.deposit_base_aa]).concat(conf.stable_base_aas).concat(conf.sf_base_aas).concat(conf.de_base_aas);
	const rows = await dag.getAAsByBaseAAs(base_aas);
	for (let row of rows) {
		console.log(`will watch AA ${row.address}`);
		await aa_state.followAA(row.address);
		watched_aas.push(row.address);
	}
	base_aas = base_aas.concat(conf.curve_base_aas);

	// watch for new AAs created based on base AAs
	for (let base_aa of base_aas) {
		await dag.loadAA(base_aa);
		network.addLightWatchedAa(base_aa); // to learn when new AAs are defined based on it
	}
	eventBus.on("aa_definition_applied", async (address, definition) => {
		let base_aa = definition[1].base_aa;
		if (base_aas.includes(base_aa)) {
			if (conf.curve_base_aas.includes(base_aa)) {
				console.log(`will watch new curve AA ${address}`);
				await CurveAA.create(address);
			}
			else {
				console.log(`will watch new non-curve AA ${address}`);
				await aa_state.followAA(address);
			}
			await addWatchedAA(address);
		}
	});

	// watch factory AAs
	for (let factory_aa of conf.factory_aas) {
		console.log(`will watch factory AA ${factory_aa}`);
		await aa_state.followAA(factory_aa);
		watched_aas.push(factory_aa);
	}

	eventBus.on("aa_request_applied", onAARequest);
	eventBus.on("aa_response_applied", onAAResponse);

	state = await getStateSnapshot();
	startWebsocketServer();
}

exports.startWatching = startWatching;
exports.addWatchedAA = addWatchedAA;
exports.updateState = updateState;
exports.getCurrentState = getCurrentState;

