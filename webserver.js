/*jslint node: true */
"use strict";

const Koa = require('koa');
const KoaRouter = require('koa-router');
const cors = require('@koa/cors');
const bodyParser = require('koa-bodyparser');
const { SitemapStream, streamToPromise } = require('sitemap');

const ValidationUtils = require('ocore/validation_utils.js');
const conf = require('ocore/conf.js');
const storage = require('ocore/storage.js');
const db = require('ocore/db.js');
const buffer = require('./buffer.js');
const orders = require('./orders.js');
const cryptocoinpro = require('./cryptocoinpro.js');
const upcomingState = require('./upcoming_state.js');
const dag = require('aabot/dag.js');

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
	console.error('create_buffer', ctx.query.address, ctx.query.curve_aa, ctx.query.ref, ctx.request.method);
	const address = ctx.query.address;
	const curve_aa = ctx.query.curve_aa;
	const referrer = ctx.query.ref;
	if (!ValidationUtils.isValidAddress(address))
		return setError(ctx, "invalid user address");
	if (referrer) {
		if (referrer === address)
			return setError(ctx, "attempt to self-refer");
		if (!ValidationUtils.isValidAddress(referrer))
			return setError(ctx, "invalid referrer address");
	}
	const error = await buffer.validateCurveAA(curve_aa);
	if (error)
		return setError(ctx, "invalid curve: " + error);
	try {
		ctx.body = {
			status: 'success',
			data: await buffer.getOrCreateBufferAddress(address, curve_aa, referrer)
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
	const data = ctx.request.body;
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

router.get('/get_state/:address', async (ctx) => {
	const address = ctx.params.address;
	if (!ValidationUtils.isValidAddress(address))
		return setError(ctx, "invalid AA address");
	try {
		const state_vars = await dag.readAAStateVars(address, "");
		ctx.body = {
			status: 'success',
			data: state_vars,
		};
	} catch (err) {
		setError(ctx, err);
	}
});

router.get('/get_factory_state', async (ctx) => {
	const state_vars_array = await Promise.all(conf.factory_aas.map((address) => dag.readAAStateVars(address, "")));
	const state_vars = state_vars_array.reduce((total, currentValue) => {
		return Object.assign(total, currentValue)
	}, {});
	ctx.body = {
		status: 'success',
		data: state_vars,
	};
});

router.get('/symbol/:asset*', async (ctx) => {
	const asset = ctx.params.asset && decodeURIComponent(ctx.params.asset);
	if (!asset) {
		return setError(ctx, "Asset is a required parameter!");
	}
	if (asset === 'base') {
		ctx.body = {
			status: 'success',
			data: "GBYTE",
		};
	} else {
		try {
			const token_registry_state = await dag.readAAStateVars(conf.token_registry_aa, `a2s_${asset}`);
			const symbol = `a2s_${asset}` in token_registry_state ? token_registry_state[`a2s_${asset}`] : asset.replace(/[+=]/, '').substr(0, 6);
			ctx.body = {
				status: 'success',
				data: symbol,
			};
		} catch (err) {
			setError(ctx, err);
		}
	}
});

router.get('/get_data_feed/:oracle/:feed_name', async (ctx) => {
	const oracle = ctx.params.oracle;
	const feed_name = ctx.params.feed_name;
	if (!ValidationUtils.isValidAddress(oracle))
		return setError(ctx, "invalid oracle");
	if (!feed_name)
		return setError(ctx, "feed_name is require!");
	try {
		const data = await dag.getDataFeed(oracle, feed_name);
		ctx.body = {
			status: 'success',
			data: data,
		};
	} catch (err) {
		setError(ctx, err);
	}
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

const langs = ["en", "zh", "es", "ru", "da"];

router.get('/sitemap.xml', async (ctx) => {
	try {
		// Creates a sitemap object given the input configuration with URLs
		const smStream = new SitemapStream({ hostname: 'https://ostable.org' });
		
		const curve_rows = await dag.getAAsByBaseAAs(conf.curve_base_aas);

		langs.forEach((lng) => {
			smStream.write({ url: `/${lng === "en" ? "" : lng}`, changefreq: 'daily', priority: 1 });
			
			for (let row of curve_rows) {
				smStream.write({ url: `${lng === "en" ? "" : `/${lng}`}/trade/${row.address}`, changefreq: 'daily', priority: 0.5 });
			}

			smStream.write({ url: `${lng === "en" ? "" : `/${lng}`}/buy`, changefreq: 'monthly', priority: 0.5 });
			smStream.write({ url: `${lng === "en" ? "" : `/${lng}`}/create`, changefreq: 'monthly', priority: 0.2 });
			smStream.write({ url: `${lng === "en" ? "" : `/${lng}`}/how-it-works`, changefreq: 'monthly', priority: 1 });
			smStream.write({ url: `${lng === "en" ? "" : `/${lng}`}/faq`, changefreq: 'monthly', priority: 1 });
		});

		smStream.end();

		ctx.set('Content-Type', 'application/xml');

		ctx.body = await streamToPromise(smStream);
	} catch (err) {
		console.error('sitemap error', err);
		ctx.status = 500;
		setError(ctx, err);
	}
});

app.use(cors());
app.use(router.routes());

function start() {
	app.listen(conf.webPort);
}

exports.start = start;
