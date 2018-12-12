import {i18nMark, Plural, Trans} from '@lingui/react'
import {ActionLink, StatusLink} from 'components/ui/DbLink'
import Rotation from 'components/ui/Rotation'
import ACTIONS from 'data/ACTIONS'
import STATUSES from 'data/STATUSES'
import {BuffEvent, CastEvent} from 'fflogs'
import _ from 'lodash'
import Module, {dependency} from 'parser/core/Module'
import Combatants from 'parser/core/modules/Combatants'
import Suggestions, {SEVERITY, TieredSuggestion} from 'parser/core/modules/Suggestions'
import React from 'react'
import {Accordion} from 'semantic-ui-react'

interface TimestampRotationMap {
	[timestamp: number]: CastEvent[]
}

const SEVERITIES = {
	MISSED_HOLY_SPIRITS: {
		1: SEVERITY.MEDIUM,
		5: SEVERITY.MAJOR,
	},
	MISSED_BUFF_REQUIESCAT: {
		1: SEVERITY.MAJOR,
	},
}

const CONSTANTS = {
	MP: {
		TICK_AMOUNT: 141,
	},
	REQUIESCAT: {
		MP_THRESHOLD: 0.8,
	},
	HOLY_SPIRIT: {
		EXPECTED: 5,
	},
}

export default class Requiescat extends Module {
	static handle = 'requiescat'
	static title = 'Requiescat Usage'
	static i18n_id = i18nMark('pld.requiescat.title') // tslint:disable-line:variable-name

	@dependency private suggestions!: Suggestions
	@dependency private combatants!: Combatants

	// Internal State Counters
	private requiescatStart: number | null = null
	private holySpiritCount = 0

	// Result Counters
	private missedHolySpirits = 0
	private requiescatNoBuff = 0
	private requiescatRotations: TimestampRotationMap = {}

	protected init() {
		this.addHook('cast', {by: 'player'}, this.onCast)
		this.addHook('removebuff', {
			by: 'player',
			abilityId: STATUSES.REQUIESCAT.id,
		}, this.onRemoveRequiescat)
		this.addHook('complete', this.onComplete)
	}

	private onCast(event: CastEvent) {
		const actionId = event.ability.guid

		if (actionId === ACTIONS.ATTACK.id) {
			return
		}

		if (actionId === ACTIONS.REQUIESCAT.id) {
			const {mp, maxMP} = this.combatants.selected.resources

			// We only track buff windows
			// Allow for inaccuracies of 1 MP Tick
			if ((mp + CONSTANTS.MP.TICK_AMOUNT) / maxMP >= CONSTANTS.REQUIESCAT.MP_THRESHOLD) {
				this.requiescatStart = event.timestamp
			} else {
				this.requiescatNoBuff++
			}
		}

		if (this.requiescatStart !== null) {
			if (actionId === ACTIONS.HOLY_SPIRIT.id) {
				this.holySpiritCount++
			}

			if (!Array.isArray(this.requiescatRotations[this.requiescatStart])) {
				this.requiescatRotations[this.requiescatStart] = []
			}

			this.requiescatRotations[this.requiescatStart].push(event)
		}
	}

	private onRemoveRequiescat() {
		this.requiescatStart = null

		// Clamp to 0 since we can't miss negative
		this.missedHolySpirits += Math.max(0, CONSTANTS.HOLY_SPIRIT.EXPECTED - this.holySpiritCount)
		this.holySpiritCount = 0
	}

	private onComplete() {
		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.REQUIESCAT.icon,
			why: <Trans id="pld.requiescat.suggestions.wrong-gcd.why">
				<Plural value={this.missedHolySpirits} one="# wrong GCD" other="# wrong GCDs"/> during the <StatusLink {...STATUSES.REQUIESCAT}/> buff window.
			</Trans>,
			content: <Trans id="pld.requiescat.suggestions.wrong-gcd.content">
				GCDs used during <ActionLink {...ACTIONS.REQUIESCAT}/> should be limited to <ActionLink {...ACTIONS.HOLY_SPIRIT}/> for optimal damage.
			</Trans>,
			tiers: SEVERITIES.MISSED_HOLY_SPIRITS,
			value: this.missedHolySpirits,
		}))

		this.suggestions.add(new TieredSuggestion({
			icon: ACTIONS.REQUIESCAT.icon,
			why: <Trans id="pld.requiescat.suggestions.nobuff.why">
				<Plural value={this.requiescatNoBuff} one="# usage" other="# usages"/> while under 80% MP.
			</Trans>,
			content: <Trans id="pld.requiescat.suggestions.nobuff.content">
				<ActionLink {...ACTIONS.REQUIESCAT}/> should only be used when over 80% MP. Try to not miss on the 20% Magic Damage buff <StatusLink {...STATUSES.REQUIESCAT}/> provides.
			</Trans>,
			tiers: SEVERITIES.MISSED_BUFF_REQUIESCAT,
			value: this.requiescatNoBuff,
		}))
	}

	output() {
		const panels = Object.keys(this.requiescatRotations)
			.map(timestamp => {
				const ts = _.toNumber(timestamp)

				const holySpiritCount = this.requiescatRotations[ts]
					.filter(event => event.ability.guid === ACTIONS.HOLY_SPIRIT.id)
					.length

				return ({
					key: timestamp,
					title: {
						content: <>
							{this.parser.formatTimestamp(ts)}
							<span> - </span>
							<span>{holySpiritCount}/{CONSTANTS.HOLY_SPIRIT.EXPECTED} <ActionLink {...ACTIONS.HOLY_SPIRIT}/></span>
						</>,
					},
					content: {
						content: <Rotation events={this.requiescatRotations[ts]}/>,
					},
				})
			})

		return (
			<Accordion
				exclusive={false}
				panels={panels}
				styled
				fluid
			/>
		)
	}
}
