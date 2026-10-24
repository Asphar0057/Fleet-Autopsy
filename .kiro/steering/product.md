# Product: Fleet Autopsy

## What it is
A browser-based, deterministic simulator of a warehouse robot fleet. When traffic jams, one click ("Find the cause") replays alternate timelines to identify the root cause, quantify its effect, and verify a fix.

## Who it is for
Operations and engineering staff at mid-size fulfillment and logistics sites running mobile-robot fleets, who cannot afford simulation consultants. Context: warehouse robotics is a real Massachusetts industry.

## How it is judged
Hackathon, Robotics track. Judges see only the GitHub repo, a video of at most 3 minutes, and a live link, with no presenter. The three criteria are Potential Value, Implementation (including thoughtful use of Kiro), and Quality and Design. Every screen must make sense without explanation.

## Honesty rules (non-negotiable)
- Results are validated in simulation only. Never claim validation on real fleets.
- Show assumptions in the UI and README.
- Inspired by fulfillment-center drive-unit systems. Do not use Amazon branding or logos, and do not imply affiliation with any company.
- Cite sources for any external claim.

## Voice
Terse, precise, lowercase microcopy where it fits. No marketing language, no exclamation marks.

## Non-goals
Real robot control, hardware, 3D, physics, accounts, a backend database.

## Roadmap (one Kiro spec each)
1. Simulation core, layouts, renderer (current).
2. Failure injection with ground-truth labels, telemetry, baseline diagnosers.
3. Diagnosis engine: abduction by simulation, then counterfactual replay.
4. Autopsy UI, AI-written report, verified fix.
