import {create} from "../../common/utils/EntityUtils.js"
import {TypeRef, downcast} from "@tutao/tutanota-utils"
import type {TypeModel} from "../../common/EntityTypes.js"

import type {UsageTestStage} from "./UsageTestStage.js"

export const UsageTestAssignmentTypeRef: TypeRef<UsageTestAssignment> = new TypeRef("sys", "UsageTestAssignment")
export const _TypeModel: TypeModel = {
	"name": "UsageTestAssignment",
	"since": 73,
	"type": "AGGREGATED_TYPE",
	"id": 1960,
	"rootId": "A3N5cwAHqA",
	"versioned": false,
	"encrypted": false,
	"values": {
		"_id": {
			"id": 1961,
			"type": "CustomId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"name": {
			"id": 1963,
			"type": "String",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"sendPings": {
			"id": 1965,
			"type": "Boolean",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"testId": {
			"id": 1962,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"variant": {
			"id": 1964,
			"type": "Number",
			"cardinality": "ZeroOrOne",
			"final": true,
			"encrypted": false
		}
	},
	"associations": {
		"stages": {
			"id": 1966,
			"type": "AGGREGATION",
			"cardinality": "Any",
			"final": false,
			"refType": "UsageTestStage",
			"dependency": null
		}
	},
	"app": "sys",
	"version": "73"
}

export function createUsageTestAssignment(values?: Partial<UsageTestAssignment>): UsageTestAssignment {
	return Object.assign(create(_TypeModel, UsageTestAssignmentTypeRef), downcast<UsageTestAssignment>(values))
}

export type UsageTestAssignment = {
	_type: TypeRef<UsageTestAssignment>;

	_id: Id;
	name: string;
	sendPings: boolean;
	testId: Id;
	variant: null | NumberString;

	stages: UsageTestStage[];
}