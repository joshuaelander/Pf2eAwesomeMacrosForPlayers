/**
 * PF2e Awesome Macros For Players - Constants and Enums
 */

export const OUTCOME = Object.freeze({
    CRIT: "crit",
    HIT: "hit",
    MISS: "miss"
});

export const DEGREE = Object.freeze({
    CRITICAL_SUCCESS: "criticalSuccess",
    SUCCESS: "success",
    FAILURE: "failure",
    CRITICAL_FAILURE: "criticalFailure"
});

export const ROLL_TYPE = Object.freeze({
    ATTACK: "attack-roll",
    DAMAGE: "damage-roll"
});

export const DEGREE_STRINGS = Object.freeze({
    CRIT: Object.freeze(["criticalSuccess", "Critical Hit", "critical-hit"]),
    MISS: Object.freeze(["criticalFailure", "Critical Miss", "critical-miss"])
});

