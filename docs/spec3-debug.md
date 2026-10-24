# Spec 3 debug log

## Curated findings

### pd-decoy-first: first-alarm baseline (task 6.2)

- Faults: decoy R6 freeze at tick 350 for 30 ticks; Primary R3 freeze at tick 550, permanent.
- `blameFirstAlarm` (Requirement 5.1 rule, unchanged) names R7: a natural 25-tick standstill from tick 254, before any fault.
- Earlier natural episodes, R3 at tick 306 and R8 at tick 340, also come before the decoy at 350.
- So the baseline never reaches the decoy. The test asserts the headline claim instead: the first alarm is non-null and does not match the Primary.
- `blameMostSevere` names R3 (logged, not asserted).
- `diagnose` names R3 as root cause (hypothesis: freeze at tick 547, permanent).

### pd-decoy-first: multi-fault miss (task 6.3)

- Requirement 4.1 asks for both faults. `diagnose` selects only the Primary (R3).
- Score with the Primary alone: 0.9963. The headroom left for any second fault is 0.0037, below `GAIN_MIN` = 0.02.
- Round-2 gains measured with base [R3 @ 547] (throwaway check, since deleted):

| hypothesis | in pruned 12 | round-2 gain |
|---|---|---|
| R6 freeze @ 594, permanent | yes (rank 7) | -0.0002 |
| R6 freeze @ 489, 32 ticks | no | +0.0002 |
| R6 freeze @ 350, 30 ticks (exact decoy) | no | +0.0037 |

- The exact decoy is generated but pruned before round 1. Even if it were scored, its gain would stay below `GAIN_MIN`. The 30-tick decoy barely changes the replay once the Primary is in place.
- The test asserts `faults.length === 1` matching the Primary. `GAIN_MIN` is unchanged. Report this miss in RESULTS.md.

## Tuning attempts

<!-- Task 10. At most 8 attempts, dev seeds 100 to 120 only. One entry per attempt: hypothesis, change, dev-seed result, kept or reverted. -->
