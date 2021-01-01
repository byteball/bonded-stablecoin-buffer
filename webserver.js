/*jslint node: true */
"use strict";

const Koa = require('koa');
const KoaRouter = require('koa-router');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');

const ValidationUtils = require('ocore/validation_utils.js');
const conf = require('ocore/conf.js');
const storage = require('ocore/storage.js');
const db = require('ocore/db.js');
const buffer = require('./buffer.js');
const orders = require('./orders.js');
const cryptocoinpro = require('./cryptocoinpro.js');
const upcomingState = require('./upcoming_state.js');

const app = new Koa();
const router = new KoaRouter();

app.use(bodyParser());


function setError(ctx, error) {
	ctx.body = {
		status: 'error',
		error: error.toString(),
	};
	console.error('ERROR:', error);
}

router.get('/create_buffer', async (ctx) => {
	console.error('create_buffer', ctx.query.address, ctx.query.curve_aa, ctx.request.method);
	const address = ctx.query.address;
	const curve_aa = ctx.query.curve_aa;
	if (!ValidationUtils.isValidAddress(address))
		return setError(ctx, "invalid user address");
	const error = await buffer.validateCurveAA(curve_aa);
	if (error)
		return setError(ctx, "invalid curve: " + error);
	try {
		ctx.body = {
			status: 'success',
			data: await buffer.getOrCreateBufferAddress(address, curve_aa)
		};
	}
	catch (err) {
		setError(ctx, err);
	}
});

router.get('/get_expected_compensation', async (ctx) => {
	console.error('get_expected_compensation', ctx.query);
	const amount_in = parseFloat(ctx.query.amount_in);
	const currency_in = ctx.query.currency_in;
	const amount_out = parseFloat(ctx.query.amount_out);
	if (!isFinite(amount_in) || !isFinite(amount_out) || !currency_in)
		return setError(ctx, "bad params");
	try {
		ctx.body = {
			status: 'success',
			data: await orders.getExpectedCompensation(amount_in, currency_in, amount_out)
		};
	}
	catch (err) {
		setError(ctx, err);
	}
});

router.post('/create_order', async (ctx) => {
	const order = ctx.request.body;
	console.error('create_order ctx', JSON.stringify(ctx, null, 2));
	console.error('create_order', order);
	if (!await buffer.getBuffer(order.buffer_address))
		return setError(ctx, "no such buffer");
	try {
		await orders.createOrder(order);
		ctx.body = {
			status: 'success',
		};
	}
	catch (err) {
		setError(ctx, err);
	}
});

router.post('/create_fiat_redirect_url', async (ctx) => {
	const data = ctx.request.data;
	console.error('create_fiat_redirect_url ctx', JSON.stringify(ctx, null, 2));
	console.error('create_fiat_redirect_url', data);
	const err = cryptocoinpro.getRequestError(data);
	if (err)
		return setError(ctx, err);
	if (!await buffer.getBuffer(data.buffer_address))
		return setError(ctx, "no such buffer");
	const url = cryptocoinpro.createCheckoutUrl(data);
	ctx.body = {
		status: 'success',
		data: url,
	};
});


router.get('/get_state', async (ctx) => {
	console.error('get_state');
	ctx.body = {
		status: 'success',
		data: await upcomingState.getCurrentState(),
	};
});

router.get('/aa/:address', async (ctx) => {
	console.error('aa', ctx.params);
	const address = ctx.params.address;
	if (!ValidationUtils.isValidAddress(address))
		return setError(ctx, "invalid AA address");
	const { arrDefinition } = await storage.readAADefinition(db, address);
	if (!arrDefinition)
		return setError(ctx, "not tracking this AA: " + address);
	ctx.body = {
		status: 'success',
		data: arrDefinition,
	};
});


app.use(cors());
app.use(router.routes());

function start() {
	app.listen(conf.webPort);
}

exports.start = start;
