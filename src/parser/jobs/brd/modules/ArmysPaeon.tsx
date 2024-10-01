import {Event, EventBardGaugeUpdate, Events} from 'event'
import {filter} from 'parser/core/filter'
import CastTime from 'parser/core/modules/CastTime'
import {CounterGauge} from "../../../core/modules/Gauge";
import {Trans} from "@lingui/react";
import React from "react";
import ACTIONS, {Action} from "../../../../data/ACTIONS";
import {formatDuration} from "../../../../utilities";

const MAX_AP_REPERTOIRE = 4

const ARMYS_PAEON_MODIFIER = {
	0: 1.00,
	1: 0.96,
	2: 0.92,
	3: 0.88,
	4: 0.84,
}

const ARMYS_MUSE_MODIFIER = {
	0: 1.00,
	1: 0.99,
	2: 0.98,
	3: 0.96,
	4: 0.88,
}

const SONG_GAUGE_INFO: {[key: number]: Action | undefined} = {
	0x5: ACTIONS.MAGES_BALLAD,
	0xA: ACTIONS.ARMYS_PAEON,
	0xF: ACTIONS.THE_WANDERERS_MINUET,
	0xC: undefined,
}

const SAME_EVENT_TOLERANCE = 100 // Tolerance in milliseconds for cases where events might be in a weird order

type EthosState = {
	apply: Events['statusApply'],
	remove: Events['statusRemove'] | null,
	gaugeStateOnApplication: EventBardGaugeUpdate,
}

export class ArmysPaeon extends CastTime {
	private apIndex: number | null = null
	private museIndex: number | null = null

	private lastApGaugeState: EventBardGaugeUpdate | null = null
	private lastEthos: EthosState | null = null

	static override debug = true

	override initialise() {
		super.initialise()

		const gaugeUpdateFilter = filter<Event>()
			.actor(this.parser.actor.id)
			.type('gaugeUpdate')

		const ethosFilter = filter<Event>()
			.target(this.parser.actor.id)
			.status(this.data.statuses.ARMYS_ETHOS.id)

		const museFilter = filter<Event>()
			.target(this.parser.actor.id)
			.status(this.data.statuses.ARMYS_MUSE.id)

		this.addEventHook(gaugeUpdateFilter, this.handleLoggedGauge)
		this.addEventHook(ethosFilter.type('statusApply'), this.onApplyEthos)
		this.addEventHook(ethosFilter.type('statusRemove'), this.onRemoveEthos)

		this.addEventHook(museFilter.type('statusApply'), this.onApplyMuse)
		this.addEventHook(museFilter.type('statusRemove'), this.onRemoveMuse)
	}

	private handleLoggedGauge(event: Events['gaugeUpdate']) {
		// If we haven't yet noted that this player has gauge update events, set that now
		if (!this.parser.actor.loggedGauge) { this.parser.actor.loggedGauge = true }

		// Store gauge state when song is Army's Paeon
		if ('song' in event) {
			if (SONG_GAUGE_INFO[event.song] === ACTIONS.ARMYS_PAEON) {

				// Handling Army's Paeon haste
				// const modifier = this.getPaeonModifier(event.repertoire)
				const modifier = 0.01
				if (!this.lastApGaugeState || event.repertoire !== this.lastApGaugeState.repertoire) {
					// Removes previous haste and add a new one
					this.reset(this.apIndex)
					this.apIndex = this.setPercentageAdjustment('all', modifier, 'both')
					this.debug(`[${this.getDebugTimestamp()}] Paeon: Changing haste to ${(1 - modifier) * 100}%`)
				}

				this.lastApGaugeState = event
			} else if (this.apIndex) {
				// Clears haste when leaving Army's Paeon
				this.reset(this.apIndex)
				this.apIndex = null
				this.debug(`[${this.getDebugTimestamp()}] Paeon: Changing haste to 0%`)
			}
		}
	}

	private onApplyMuse(event: Events['statusApply']): void {
		if (this.museIndex == null) {
			// If Muse is applied, either the user was in Army's Paeon or had Army's Ethos
			const stacks = this.getMuseStacks(event.timestamp)
			const modifier = this.getMuseModifier(stacks)

			this.museIndex = this.setPercentageAdjustment('all', modifier, 'both')
			this.debug(`[${this.getDebugTimestamp()}] Muse: Changing haste to ${(1 - modifier) * 100}%`)
		}
	}

	private onRemoveMuse(): void {
		this.reset(this.museIndex)
		this.museIndex = null
		this.debug(`[${this.getDebugTimestamp()}] Muse: Changing haste to 0%`)
	}

	private onApplyEthos(event: Events['statusApply']): void {

		if (!this.lastApGaugeState) {
			// It's impossible to have Ethos without having cast Army's Paeon at least once, so something has gone wrong here
			this.debug('Army\'s Ethos applied, but no song state found')
			return
		}

		this.lastEthos = {
			apply: event,
			remove: null,
			gaugeStateOnApplication: this.lastApGaugeState,
		}
	}

	private onRemoveEthos(event: Events['statusRemove']): void {
		if (!this.lastEthos) {
			// Trying to remove a status that wasn't registered previously
			this.debug('Army\'s Ethos removed, but no previous application found')
			return
		}

		this.lastEthos.remove = event
	}

	private getMuseStacks(timestamp: number): number {
		// If Ethos was active
		if (this.lastEthos?.apply) {
			// If ethos was removed around the given time, then get the stacks information from ethos
			if (this.lastEthos.remove && this.isTimestampInBetween(timestamp, this.lastEthos.remove.timestamp)) {
				return this.lastEthos.gaugeStateOnApplication.repertoire
			}

			// If ethos was not removed but is still active, get the stacks information from ethos
			if (timestamp <= this.lastEthos.apply.timestamp + this.data.statuses.ARMYS_ETHOS.duration + SAME_EVENT_TOLERANCE) {
				return this.lastEthos.gaugeStateOnApplication.repertoire
			}
		}

		// If Ethos was not active, get the stacks from gauge
		if (this.lastApGaugeState) {
			return this.lastApGaugeState.repertoire
		}

		// This shouldn't happen
		this.debug('No valid information about Army\'s Paeon repertoire stacks to determine strength of Army\'s Muse')
		return 0
	}

	private getMuseModifier(stacks: number) {
		if (stacks < 0 || stacks > MAX_AP_REPERTOIRE) {
			return 1.00 // Should never happen, stacks go from 0 to 4
		}

		// eslint-disable-next-line @typescript-eslint/no-magic-numbers
		return ARMYS_MUSE_MODIFIER[stacks as 1|2|3|4]
	}

	private getPaeonModifier(stacks: number) {
		if (stacks < 0 || stacks > MAX_AP_REPERTOIRE) {
			return 1.00 // Should never happen, stacks go from 0 to 4
		}

		// eslint-disable-next-line @typescript-eslint/no-magic-numbers
		return ARMYS_PAEON_MODIFIER[stacks as 1|2|3|4]
	}

	private isTimestampInBetween(timestamp: number, targetTimestamp: number): boolean {
		return timestamp >= targetTimestamp - SAME_EVENT_TOLERANCE || timestamp <= targetTimestamp + SAME_EVENT_TOLERANCE
	}

	private getDebugTimestamp(): string {
		return formatDuration(
			this.parser.currentEpochTimestamp - this.parser.pull.timestamp,
			{secondPrecision: 3, showNegative: true},
		)
	}
}
