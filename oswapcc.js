/*jslint node: true */
"use strict";

const fetch = require('node-fetch');

const URL = 'https://wallet.obytechina.org/api';


const request = (endpoint, options) => {
	return fetch(`${URL}${endpoint}`, {
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		...options
	})
}

const createExchange = async (in_amount, in_coin, out_address) => {
	const params = {
		in_amount,
		in_coin,
		out_coin: 'GBYTE',
		out_address,
	};
	const response = await request(`/create_swap`, {
		body: JSON.stringify(params),
		method: 'POST'
	})

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	if (!data.data) {
		console.error('-- no data in response', data)
		throw new Error(`no data in response ${JSON.stringify(data)}`)
	}
	return data.data
}

const fetchExchangeInfo = async (id) => {
	const response = await request(`/get_status/${id}`)

//	console.error(JSON.stringify(response, null, 2))
//	console.error('ok', response.ok)

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	if (!data.data) {
		console.error('-- no data in response', data)
		throw new Error(`no data in response ${JSON.stringify(data)}`)
	}
	return data.data
}

async function test() {
	const data = await fetchExchangeInfo(2);
//	const data = await createExchange(.005, 'BTC', 'EV4PGZDEWC572QD3EJ5DE4GDTC56UI2L');
	console.log(data);
}
//test();

exports.createExchange = createExchange;
exports.fetchExchangeInfo = fetchExchangeInfo;
