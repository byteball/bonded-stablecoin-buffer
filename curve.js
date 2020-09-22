"use strict";

const eventBus = require('ocore/event_bus.js');
const db = require('ocore/db.js');
const conf = require('ocore/conf.js');
const formulaEvaluation = require("ocore/formula/evaluation.js");
const dag = require('aabot/dag.js');
const aa_state = require('aabot/aa_state.js');
const light_data_feeds = conf.bLight ? require('aabot/light_data_feeds.js') : null;

const ORACLE_UPDATE_INTERVAL = 2 * 60 * 1000;

class CurveAA {
	#curve_aa;
	#params;
	#oracles;
	
	constructor(curve_aa, params, oracles) {
		this.#curve_aa = curve_aa;
		this.#params = params;
		this.#oracles = oracles;
		setInterval(() => this.updateDataFeeds(), ORACLE_UPDATE_INTERVAL);
	}

	static async create(curve_aa) {
		const params = await dag.readAAParams(curve_aa);
		const oracles = await dag.executeGetter(curve_aa, 'get_oracles');

		if (conf.bLight)
			for (let oracle of oracles)
				await light_data_feeds.updateDataFeed(oracle.oracle, oracle.feed_name);

		await aa_state.followAA(curve_aa);

		return new CurveAA(curve_aa, params, oracles);
	}

	async updateDataFeeds(bForce, bQuiet) {
		if (!conf.bLight)
			return;
		let bUpdated = false;
		for (let oracle of this.#oracles)
			if (await light_data_feeds.updateDataFeed(oracle.oracle, oracle.feed_name, bForce))
				bUpdated = true;
		if (bUpdated && !bQuiet)
			eventBus.emit('data_feeds_updated');
	}

	// calculates how many T2 tokens we get for the given amount of the reserve currency assuming there are no fees
	get_ds2(dr) {
		const p = this.#params;
		const v = aa_state.getUpcomingAAStateVars(this.#curve_aa);
		const new_r = (v.reserve + dr) / 10 ** p.reserve_asset_decimals;
		const s1 = v.supply1 / 10 ** p.decimals1;
		const new_s2 = (new_r / s1 ** p.m) ** (1 / p.n);
		return Math.floor(new_s2 * 10 ** p.decimals2 - v.supply2);
	}

	async get_exchange_result(tokens1, tokens2) {
		const res = await formulaEvaluation.executeGetterInState(db, this.#curve_aa, 'get_exchange_result', [tokens1, tokens2], aa_state.getUpcomingStateVars(), aa_state.getUpcomingBalances());
		const turnover = Math.abs(res.reserve_delta);
		res.fee_percent = res.fee / turnover * 100;
		return res;
	}

	// tries to find the max amount of tokens2 we can buy for this amount of the reserve currency
	async get_tokens2_amount(balance, max_fee_percent) {
		if (balance <= 0)
			return 0;
		let amount = 0;
		const unlock = await aa_state.lock();
		let top = this.get_ds2(balance);
		let bottom = 0;
		let i = 0;

		// tests this amount and tries again
		const test = async (tokens2) => {
			i++;
			console.log(`${i}: testing ${tokens2} tokens2`);
			if (i > 10) // give up
				return console.log(`stopping, too many iterations`);
			const res = await this.get_exchange_result(0, tokens2);
			console.log('--- res', res);
			if (res.fee_percent <= max_fee_percent) {
				if (res.reserve_needed <= balance) {
					amount = tokens2; // we'll use this result if we don't find anything better
					if (tokens2 < top) { // try to go up
						bottom = tokens2;
						await test(Math.floor((tokens2 + top) / 2));
					}
				}
				else { // scale down a bit assuming linear dependence
					top = Math.floor(tokens2 * balance / res.reserve_needed);
					await test(top);
				}
			}
			else { // go down
				top = tokens2;
				await test(Math.floor((bottom + tokens2) / 2));
			}
		};

		await this.updateDataFeeds(false, true);
		await test(top);
		console.log(`found optimal amount: ${amount}`);
		unlock();
		return amount;
	}

}

module.exports = CurveAA;
