# Limitations

JVLN estimates performance on the measured constructs. It does not measure "true intelligence", and in its current state it cannot place anyone in a population. This document lists what limits the interpretation of its results.

## 1. No normative sample yet

- All item parameters are **provisional**. They are predicted from item complexity features, not estimated from response data.
- The θ scale is anchored to those predictions. It is not scaled to any population, so a θ of 2.0 means "performed like someone who solves our predicted-2.0 items half the time", not "two SDs above the population mean".
- Ranks are therefore shown as **Provisional · unnormed**, and no percentiles are displayed.
- Normed ranks need a large calibration sample (see `RESEARCH.md` §16), analysis of differential item functioning, and norms weighted to a defined population.

## 2. Validity evidence is still to come

- **Construct validity.** Paradigms were chosen from established traditions, but the JVLN versions have not been validated. Factor structure, convergent correlations (e.g., with ICAR) and discriminant correlations are planned, not done.
- **Criterion validity.** Nothing is known yet about how JVLN scores relate to education, job performance or any other outcome.
- **Experimental constructs.** Adaptive/Natural Intelligence, Strategic Intelligence, AI/Prompting and Visual/Design are JVLN constructs. They are not established psychometric factors.

## 3. Reliability

- Precision is reported per person as a standard error. With the stopping rules used here, domain SEs typically land between 0.35 and 0.50, which corresponds to reliability of roughly .75–.88. That is adequate for a profile but too coarse for fine distinctions between neighbouring ranks.
- Test–retest reliability is unknown.
- Difference scores (switch costs, flanker effects, dual-task costs, search slopes) are known to be unreliable for individuals (Hedge et al., 2018). They are shown for insight only.
- N-back is not ranked because of its low reliability (Jaeggi et al., 2010).

## 4. Practice effects and retakes

Scores rise on retake, through familiarity with the paradigm and strategy learning. JVLN generates new items on each attempt and records the attempt number, but it cannot remove practice effects. Only first attempts should enter future norms.

## 5. Devices and browsers

- Browser timing adds roughly 25–45 ms of latency with some variability. Keyboards and touchscreens add device-specific delays that can reach about 100 ms.
- RT metrics are therefore not comparable across devices or input types. Mobile RTs are not comparable to desktop RTs.
- RTs never enter a composite score.
- Small screens reduce the visual field for search and matrix tasks. JVLN recommends a desktop or tablet for the Full assessment.

## 6. Language, culture and education

- JVLN is English-only. Knowledge-loaded language items (vocabulary) favour native speakers and people with more formal education. They are tagged separately from reasoning items.
- Figural and nonsense-term formats reduce, but do not eliminate, cultural effects. Familiarity with puzzles, games and standardised tests helps.
- Educational background affects quantitative and probabilistic items.

## 7. Response strategy and effort

- Guessing, rushing, fatigue and low motivation lower scores for reasons unrelated to ability. Rapid guesses are detected and excluded, but slow disengagement is not.
- Long sessions cause fatigue. Quick and Core modes exist for this reason, and sessions can be paused.
- Multiple-choice items allow guessing. The 3PL guessing parameter models this on average, not individually.

## 8. Item leakage

Authored items (social, strategic, language, applied) can be shared or looked up. Generated items are new each time, but the *paradigms* can be practised. Exposure is tracked only on the device, because there is no server.

## 9. Adaptive-testing requirements

A well-functioning CAT needs calibrated parameters, enough items at every difficulty level, and exposure control across users. Today:

- Generated paradigms have effectively unlimited items, but their difficulty is predicted, not measured.
- Authored banks are small (dozens of items), so their upper tail is thin. Estimates above the hardest available item are flagged as ceiling estimates.
- The upper tail (Elite and Apex bands) is where predicted difficulty is least certain. A person who solves everything will be flagged, not ranked.

## 10. Task difficulty is not measured ability

An item designed for the Apex band is a hypothesis about difficulty. Solving it does not show "160-level intelligence". Only calibration on a population can connect item difficulty to ability percentiles.

## 11. AI-assisted scoring

JVLN does not use LLM scoring. Originality and flexibility in creativity tasks are marked *Calibration required*. If AI-assisted scoring is added later, it must be validated against trained human raters, reported with its agreement statistics, and never be the only source of a score.

## 12. Social cognition

Text-based scenarios and belief-tracking stories measure the *reasoning* side of social cognition: representing beliefs, intentions and incentives. They do not measure real-time emotion perception, empathy in behaviour, or social skill. Face-based emotion recognition is not included, because the best-known instrument has poor psychometric properties and validated stimulus sets need licences.

## 13. Not for high-stakes use

JVLN must not be used for clinical diagnosis, hiring, admissions or any other decision about a person. It is an open-mode, unproctored self-assessment (ITC, 2006).
