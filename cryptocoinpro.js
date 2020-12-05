/*jslint node: true */
"use strict";

const fs = require('fs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const conf = require('ocore/conf.js');
const desktopApp = require('ocore/desktop_app.js');

const URL = 'https://appapi-public.cryptocoin.pro/api/v1';


const request = (endpoint, options) => {
	const privateKey = fs.readFileSync(desktopApp.getAppDataDir() + '/jwt-private.pem');
	const payload = {
	//	id: "hdhdjdjee",
		email: "emaeil@dogddmain.com",
		expire: Math.round(Date.now() / 1000) + 3600,
	};
	const token = jwt.sign(payload, privateKey, { algorithm: 'RS512' });
	return fetch(`${URL}${endpoint}`, {
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Token: token,
		},
		...options
	})
}

function getRequestError(data) {
	if (!data.first_name)
		return "no first name";
	if (!data.last_name)
		return "no last name";
	if (!data.dob)
		return "no date of birth";
	if (!data.email)
		return "no email";
	if (!data.buffer_address)
		return "no buffer_address";
	if (!data.amount)
		return "no amount";
	if (!['card', 'bank'].includes(data.method))
		return "bad method: " + data.method;
	if (data.fiat !== 'EUR')
		return "bad fiat currency: " + data.fiat;
	return null;
}

function createCheckoutUrl(data) {
	const privateKey = fs.readFileSync(desktopApp.getAppDataDir() + '/jwt-private.pem')//+'hhh';
	const payload = {
		"user": {
			"id": Math.random().toString(),
			"email": data.email,
			"first_name": data.first_name,
			"last_name": data.last_name,
			"dob": data.dob,
			"wallet": data.buffer_address
		},
		"payment": {
			"operation": "buy",
			"type": "coin",
			"symbol": "GBYTE",
			"amount": data.amount,
			"rate": "2000.1300000000000000000000000",
			"fiat": data.fiat,
			"request_id": Math.random().toString(),
			"method": data.method,
			"attempts": 3,
			"second_order_type": "withdraw"
		},
		"ping_url": null,
		"redirect_url": "https://ostable.org/",
		"expire": Math.round(Date.now() / 1000) + 24 * 3600
	};
	console.log(payload)
	const token = jwt.sign(payload, privateKey, { algorithm: 'RS512' });
	console.log({ token });
	const url = `https://dev-checkout.infra.cryptocoin.pro/?lang=en&display=light&landing=false&platform=${conf.cryptoCoinProPlatform}&token=${token}`;
	return url;
}

const authenticate = async () => {
	const params = {
	};
	const response = await request(`/authenticate-jwt/${conf.cryptoCoinProPlatform}`, {
	//	body: JSON.stringify(params),
		method: 'POST'
	})

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	console.log(data)
	return data
}

async function test() {
	const url = createCheckoutUrl({
		email: "addr" + Math.random().toString().substr(2) + "@gmail.com",
		first_name: '-',
		last_name: '-',
		dob: '1990-04-01',
		buffer_address: 'myWalletttttt',
		amount: 2000,
		fiat: 'EUR',
		method: 'card',
	});
	console.log(url);
//	await authenticate();
}
test();

exports.getRequestError = getRequestError;
exports.createCheckoutUrl = createCheckoutUrl;


