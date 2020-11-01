/*jslint node: true */
"use strict";
const eventBus = require('ocore/event_bus.js');
const network = require('ocore/network.js');
const conf = require('ocore/conf.js');

const operator = require('aabot/operator.js');
const buffer = require('./buffer.js');
const webserver = require('./webserver.js');
const upcomingState = require('./upcoming_state.js');


eventBus.on('headless_wallet_ready', async () => {
	await operator.start();

	if (!conf.simpleswapApiKey)
		throw Error("Please specify simpleswapApiKey in conf.json");

	network.start();
	await buffer.startWatching();
	webserver.start();

	await upcomingState.startWatching();
});

process.on('unhandledRejection', up => { throw up; });
