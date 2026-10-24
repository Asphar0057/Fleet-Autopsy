# Diagnosis benchmark

validated in simulation only. not validated on real fleets.

mode full · 2000 ticks per run · 60 scenarios · 120 cases (world and primary-only per scenario)

## Accuracy

A method is correct when its target matches the primary fault (`matchesGroundTruth`). Cases without a jam detection count as wrong for every method.

| method | overall | robot-freeze | station-slowdown | blocked-cell | slow-robot | world | primary-only |
| --- | --- | --- | --- | --- | --- | --- | --- |
| diagnose (replay) | 47 / 120 (39.2%) | 42 / 66 (63.6%) | 5 / 54 (9.3%) | 0 / 0 (0.0%) | 0 / 0 (0.0%) | 16 / 60 (26.7%) | 31 / 60 (51.7%) |
| first alarm | 3 / 120 (2.5%) | 2 / 66 (3.0%) | 1 / 54 (1.9%) | 0 / 0 (0.0%) | 0 / 0 (0.0%) | 1 / 60 (1.7%) | 2 / 60 (3.3%) |
| most severe | 56 / 120 (46.7%) | 56 / 66 (84.8%) | 0 / 54 (0.0%) | 0 / 0 (0.0%) | 0 / 0 (0.0%) | 29 / 60 (48.3%) | 27 / 60 (45.0%) |

- not detected: 49 of 120 cases

### Among detected jams

| method | detected | world | primary-only |
| --- | --- | --- | --- |
| diagnose (replay) | 47 / 71 (66.2%) | 16 / 35 (45.7%) | 31 / 36 (86.1%) |
| first alarm | 3 / 71 (4.2%) | 1 / 35 (2.9%) | 2 / 36 (5.6%) |
| most severe | 56 / 71 (78.9%) | 29 / 35 (82.9%) | 27 / 36 (75.0%) |

### Failure reasons

| method | not-detected | no-fault | named-decoy | wrong-kind | wrong-target |
| --- | --- | --- | --- | --- | --- |
| diagnose (replay) | 49 | 5 | 0 | 2 | 17 |
| first alarm | 49 | 0 | 0 | 4 | 64 |
| most severe | 49 | 0 | 0 | 5 | 10 |

- median replays per diagnosis: 21
- median ms per diagnosis: 783
- the baselines only name robot-freeze or station-slowdown targets, so they cannot be correct on blocked-cell or slow-robot primaries.

## Failures

| case | primary | diagnose (replay) | first alarm | most severe |
| --- | --- | --- | --- | --- |
| pocket-dc-gen-1000-0/world | station-slowdown S01 @629 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1000-0/primary-only | station-slowdown S01 @629 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1001-0/world | station-slowdown S02 @630 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1001-0/primary-only | station-slowdown S02 @630 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1002-0/world | station-slowdown S01 @502 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1002-0/primary-only | station-slowdown S01 @502 | ok | robot-freeze R8 · wrong-kind | robot-freeze R7 · wrong-kind |
| pocket-dc-gen-1003-0/world | robot-freeze R8 @696 | robot-freeze R6 · wrong-target | robot-freeze R4 · wrong-target | ok |
| pocket-dc-gen-1003-0/primary-only | robot-freeze R8 @696 | ok | robot-freeze R4 · wrong-target | ok |
| pocket-dc-gen-1004-0/world | station-slowdown S02 @589 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1004-0/primary-only | station-slowdown S02 @589 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1005-0/world | robot-freeze R1 @496 | robot-freeze R6 · wrong-target | robot-freeze R3 · wrong-target | ok |
| pocket-dc-gen-1005-0/primary-only | robot-freeze R1 @496 | ok | robot-freeze R3 · wrong-target | ok |
| pocket-dc-gen-1006-0/world | station-slowdown S02 @612 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1006-0/primary-only | station-slowdown S02 @612 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1007-0/world | robot-freeze R5 @655 | ok | robot-freeze R6 · wrong-target | ok |
| pocket-dc-gen-1007-0/primary-only | robot-freeze R5 @655 | ok | robot-freeze R6 · wrong-target | ok |
| pocket-dc-gen-1008-0/world | station-slowdown S01 @690 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1008-0/primary-only | station-slowdown S01 @690 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1009-0/world | station-slowdown S02 @645 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1009-0/primary-only | station-slowdown S02 @645 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1010-0/world | robot-freeze R8 @501 | ok | robot-freeze R4 · wrong-target | ok |
| pocket-dc-gen-1010-0/primary-only | robot-freeze R8 @501 | ok | robot-freeze R4 · wrong-target | robot-freeze R2 · wrong-target |
| pocket-dc-gen-1011-0/world | station-slowdown S01 @698 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1011-0/primary-only | station-slowdown S01 @698 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1012-0/world | station-slowdown S01 @454 | ok | robot-freeze R5 · wrong-kind | robot-freeze R8 · wrong-kind |
| pocket-dc-gen-1012-0/primary-only | station-slowdown S01 @454 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1013-0/world | station-slowdown S01 @413 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1013-0/primary-only | station-slowdown S01 @413 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1014-0/world | station-slowdown S02 @665 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1014-0/primary-only | station-slowdown S02 @665 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1015-0/world | robot-freeze R1 @495 | ok | robot-freeze R6 · wrong-target | ok |
| pocket-dc-gen-1015-0/primary-only | robot-freeze R1 @495 | ok | robot-freeze R6 · wrong-target | ok |
| pocket-dc-gen-1016-0/world | station-slowdown S01 @595 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1016-0/primary-only | station-slowdown S01 @595 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1017-0/world | station-slowdown S02 @584 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1017-0/primary-only | station-slowdown S02 @584 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1018-0/world | station-slowdown S02 @600 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1018-0/primary-only | station-slowdown S02 @600 | none · not-detected | none · not-detected | none · not-detected |
| pocket-dc-gen-1019-0/world | robot-freeze R5 @370 | none · no-fault | robot-freeze R6 · wrong-target | ok |
| pocket-dc-gen-1019-0/primary-only | robot-freeze R5 @370 | robot-freeze R1 · wrong-target | robot-freeze R6 · wrong-target | robot-freeze R1 · wrong-target |
| fulfillment-block-gen-1000-0/world | robot-freeze R3 @657 | ok | robot-freeze R24 · wrong-target | ok |
| fulfillment-block-gen-1000-0/primary-only | robot-freeze R3 @657 | robot-freeze R2 · wrong-target | robot-freeze R24 · wrong-target | robot-freeze R2 · wrong-target |
| fulfillment-block-gen-1001-0/world | robot-freeze R8 @486 | robot-freeze R5 · wrong-target | robot-freeze R29 · wrong-target | ok |
| fulfillment-block-gen-1001-0/primary-only | robot-freeze R8 @486 | ok | robot-freeze R29 · wrong-target | ok |
| fulfillment-block-gen-1002-0/world | robot-freeze R7 @368 | none · no-fault | robot-freeze R17 · wrong-target | ok |
| fulfillment-block-gen-1002-0/primary-only | robot-freeze R7 @368 | ok | robot-freeze R17 · wrong-target | ok |
| fulfillment-block-gen-1003-0/world | robot-freeze R35 @696 | none · no-fault | robot-freeze R31 · wrong-target | ok |
| fulfillment-block-gen-1003-0/primary-only | robot-freeze R35 @696 | ok | robot-freeze R31 · wrong-target | ok |
| fulfillment-block-gen-1004-0/world | robot-freeze R25 @526 | robot-freeze R34 · wrong-target | robot-freeze R18 · wrong-target | ok |
| fulfillment-block-gen-1004-0/primary-only | robot-freeze R25 @526 | ok | robot-freeze R18 · wrong-target | ok |
| fulfillment-block-gen-1005-0/world | robot-freeze R2 @428 | ok | robot-freeze R26 · wrong-target | ok |
| fulfillment-block-gen-1005-0/primary-only | robot-freeze R2 @428 | ok | robot-freeze R26 · wrong-target | ok |
| fulfillment-block-gen-1006-0/world | robot-freeze R35 @500 | ok | robot-freeze R34 · wrong-target | robot-freeze R8 · wrong-target |
| fulfillment-block-gen-1006-0/primary-only | robot-freeze R35 @500 | robot-freeze R25 · wrong-target | robot-freeze R34 · wrong-target | robot-freeze R25 · wrong-target |
| fulfillment-block-gen-1007-0/world | robot-freeze R32 @477 | robot-freeze R31 · wrong-target | robot-freeze R19 · wrong-target | robot-freeze R31 · wrong-target |
| fulfillment-block-gen-1007-0/primary-only | robot-freeze R32 @477 | robot-freeze R31 · wrong-target | robot-freeze R19 · wrong-target | robot-freeze R31 · wrong-target |
| fulfillment-block-gen-1008-0/world | robot-freeze R27 @660 | ok | robot-freeze R12 · wrong-target | ok |
| fulfillment-block-gen-1008-0/primary-only | robot-freeze R27 @660 | ok | robot-freeze R12 · wrong-target | ok |
| fulfillment-block-gen-1009-0/world | robot-freeze R23 @491 | robot-freeze R15 · wrong-target | robot-freeze R6 · wrong-target | ok |
| fulfillment-block-gen-1009-0/primary-only | robot-freeze R23 @491 | ok | robot-freeze R6 · wrong-target | ok |
| fulfillment-block-gen-1010-0/world | robot-freeze R33 @501 | station-slowdown S05 · wrong-kind | robot-freeze R30 · wrong-target | ok |
| fulfillment-block-gen-1010-0/primary-only | robot-freeze R33 @501 | ok | robot-freeze R30 · wrong-target | ok |
| fulfillment-block-gen-1011-0/world | robot-freeze R6 @628 | ok | robot-freeze R35 · wrong-target | ok |
| fulfillment-block-gen-1011-0/primary-only | robot-freeze R6 @628 | ok | robot-freeze R35 · wrong-target | ok |
| fulfillment-block-gen-1012-0/world | robot-freeze R35 @699 | robot-freeze R1 · wrong-target | robot-freeze R23 · wrong-target | ok |
| fulfillment-block-gen-1012-0/primary-only | robot-freeze R35 @699 | ok | robot-freeze R23 · wrong-target | ok |
| fulfillment-block-gen-1013-0/world | robot-freeze R4 @495 | none · no-fault | robot-freeze R31 · wrong-target | ok |
| fulfillment-block-gen-1013-0/primary-only | robot-freeze R4 @495 | ok | robot-freeze R31 · wrong-target | ok |
| fulfillment-block-gen-1014-0/world | robot-freeze R22 @695 | ok | robot-freeze R34 · wrong-target | ok |
| fulfillment-block-gen-1014-0/primary-only | robot-freeze R22 @695 | ok | robot-freeze R34 · wrong-target | ok |
| fulfillment-block-gen-1015-0/world | robot-freeze R5 @495 | station-slowdown S02 · wrong-kind | robot-freeze R30 · wrong-target | ok |
| fulfillment-block-gen-1015-0/primary-only | robot-freeze R5 @495 | ok | robot-freeze R30 · wrong-target | ok |
| fulfillment-block-gen-1016-0/world | robot-freeze R32 @511 | none · no-fault | robot-freeze R21 · wrong-target | ok |
| fulfillment-block-gen-1016-0/primary-only | robot-freeze R32 @511 | robot-freeze R11 · wrong-target | robot-freeze R21 · wrong-target | robot-freeze R11 · wrong-target |
| fulfillment-block-gen-1017-0/world | robot-freeze R32 @415 | robot-freeze R6 · wrong-target | robot-freeze R24 · wrong-target | robot-freeze R6 · wrong-target |
| fulfillment-block-gen-1017-0/primary-only | robot-freeze R32 @415 | ok | robot-freeze R24 · wrong-target | ok |
| fulfillment-block-gen-1018-0/world | station-slowdown S03 @421 | ok | robot-freeze R22 · wrong-kind | robot-freeze R21 · wrong-kind |
| fulfillment-block-gen-1018-0/primary-only | station-slowdown S03 @421 | none · not-detected | none · not-detected | none · not-detected |
| fulfillment-block-gen-1019-0/world | robot-freeze R21 @370 | ok | robot-freeze R34 · wrong-target | ok |
| fulfillment-block-gen-1019-0/primary-only | robot-freeze R21 @370 | ok | robot-freeze R34 · wrong-target | ok |
| chokepoint-gen-1000-0/world | station-slowdown S03 @430 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1000-0/primary-only | station-slowdown S03 @430 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1001-0/world | robot-freeze R4 @486 | ok | robot-freeze R19 · wrong-target | ok |
| chokepoint-gen-1001-0/primary-only | robot-freeze R4 @486 | ok | robot-freeze R19 · wrong-target | ok |
| chokepoint-gen-1002-0/world | station-slowdown S01 @502 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1002-0/primary-only | station-slowdown S01 @502 | ok | robot-freeze R17 · wrong-kind | robot-freeze R12 · wrong-kind |
| chokepoint-gen-1003-0/world | station-slowdown S03 @698 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1003-0/primary-only | station-slowdown S03 @698 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1004-0/world | robot-freeze R15 @526 | ok | robot-freeze R10 · wrong-target | ok |
| chokepoint-gen-1004-0/primary-only | robot-freeze R15 @526 | ok | robot-freeze R10 · wrong-target | ok |
| chokepoint-gen-1005-0/world | robot-freeze R1 @428 | robot-freeze R17 · wrong-target | robot-freeze R12 · wrong-target | ok |
| chokepoint-gen-1005-0/primary-only | robot-freeze R1 @428 | ok | robot-freeze R12 · wrong-target | ok |
| chokepoint-gen-1006-0/world | station-slowdown S01 @674 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1006-0/primary-only | station-slowdown S01 @674 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1008-0/world | robot-freeze R16 @660 | robot-freeze R19 · wrong-target | robot-freeze R20 · wrong-target | ok |
| chokepoint-gen-1008-0/primary-only | robot-freeze R16 @660 | ok | robot-freeze R20 · wrong-target | ok |
| chokepoint-gen-1009-0/world | station-slowdown S03 @645 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1009-0/primary-only | station-slowdown S03 @645 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1010-0/world | robot-freeze R20 @501 | robot-freeze R18 · wrong-target | robot-freeze R8 · wrong-target | robot-freeze R6 · wrong-target |
| chokepoint-gen-1010-0/primary-only | robot-freeze R20 @501 | ok | robot-freeze R8 · wrong-target | ok |
| chokepoint-gen-1011-0/world | station-slowdown S01 @352 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1011-0/primary-only | station-slowdown S01 @352 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1012-0/world | station-slowdown S01 @454 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1012-0/primary-only | station-slowdown S01 @454 | ok | ok | robot-freeze R21 · wrong-kind |
| chokepoint-gen-1013-0/world | station-slowdown S02 @413 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1013-0/primary-only | station-slowdown S02 @413 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1014-0/world | station-slowdown S02 @354 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1014-0/primary-only | station-slowdown S02 @354 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1015-0/world | robot-freeze R3 @495 | robot-freeze R15 · wrong-target | robot-freeze R20 · wrong-target | ok |
| chokepoint-gen-1015-0/primary-only | robot-freeze R3 @495 | ok | robot-freeze R20 · wrong-target | ok |
| chokepoint-gen-1016-0/world | station-slowdown S01 @595 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1016-0/primary-only | station-slowdown S01 @595 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1017-0/world | station-slowdown S03 @584 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1017-0/primary-only | station-slowdown S03 @584 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1018-0/world | station-slowdown S02 @421 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1018-0/primary-only | station-slowdown S02 @421 | none · not-detected | none · not-detected | none · not-detected |
| chokepoint-gen-1019-0/world | robot-freeze R13 @370 | ok | robot-freeze R21 · wrong-target | ok |
| chokepoint-gen-1019-0/primary-only | robot-freeze R13 @370 | ok | robot-freeze R21 · wrong-target | ok |

## Constants

tuned on dev seeds 100 to 120 only; benchmark seeds start at 1000.

| constant | value |
| --- | --- |
| STALL_MIN | 20 |
| SERVE_STALL | 60 |
| HOTSPOTS | 16 |
| MOVE_WINDOW | 200 |
| BLOCK_GAP | 60 |
| BLOCK_ENTRIES | 5 |
| BLOCK_LOOKBACK | 200 |
| K_FREEZE | 4 |
| K_EPISODE | 8 |
| K_BLOCK | 3 |
| EARLY_SERVICES | 5 |
| EARLY_MIN | 3 |
| SLOW_RATIO_MIN | 1.5 |
| SLOW_MIN_MOVES | 6 |
| POST_WEIGHT | 1 |
| W_POS | 0.3 |
| W_TP | 0.5 |
| W_QUEUE | 0.2 |
| ROUND_K | 8 |
| HIGH_SCORE | 0.95 |
| HIGH_GAP | 0.15 |
| MED_SCORE | 0.8 |
| MED_GAP | 0.05 |
