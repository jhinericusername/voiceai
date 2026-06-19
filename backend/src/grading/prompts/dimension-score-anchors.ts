import type { EvaluationDimensionKey } from "../evaluation/scorecard.js";

export type DimensionScoreAnchorScore = 1 | 2 | 3 | 4;
export type DimensionScoreAnchorScoreKey = "1" | "2" | "3" | "4";

export interface DimensionScoreAnchor {
  readonly id: string;
  readonly source: string;
  readonly score: DimensionScoreAnchorScore;
  readonly label: string;
  readonly answerExcerpt: string;
  readonly whyThisScore: string;
}

export type DimensionScoreAnchors = Record<
  EvaluationDimensionKey,
  Record<DimensionScoreAnchorScoreKey, readonly DimensionScoreAnchor[]>
>;

const scoreKeys = ["1", "2", "3", "4"] as const;
const dimensions = ["problem_solving", "agency", "competitiveness", "curious"] as const;

export function defaultDimensionScoreAnchors(): DimensionScoreAnchors {
  return {
    problem_solving: {
      "1": [
        {
          id: "problem_solving_1_liaison_no_implementation_depth",
          source: "weave_user_provided_and_artifact_seed_v1",
          score: 1,
          label: "Asked for a clever technical solve, but cannot show implementation or ownership.",
          answerExcerpt:
            "I did not do much of the tagging myself. I was kind of just a liaison and coordinated between the customer and engineering. I am trying to think of the terminology right now, but I have not described this in a minute.",
          whyThisScore:
            "This is an actual answer pattern where the candidate does not establish personal technical ownership, a hard constraint, or a clever solution. Coordination can be useful, but it is not enough evidence for technical problem solving.",
        },
      ],
      "2": [
        {
          id: "problem_solving_2_practical_old_pattern",
          source: "weave_top12_disagreement_yusif_ps2",
          score: 2,
          label: "Practical workaround, but mostly standard or old-pattern implementation.",
          answerExcerpt:
            "Angular at that point was too complex, so I looked back at the jQuery that I was already very good with. I used the hash change event, grabbed whatever is after the hash, and built a small UI router on top of that.",
          whyThisScore:
            "This solves a real problem and shows practical resourcefulness, but the solution is mostly a familiar workaround and explicitly avoids the harder framework complexity rather than demonstrating an unusually clever technical solve.",
        },
      ],
      "3": [
        {
          id: "problem_solving_3_matching_cache_feed",
          source: "weave_top12_disagreement_danny_ps3",
          score: 3,
          label: "Concrete build with constraints, tradeoffs, and implementation details.",
          answerExcerpt:
            "We had to do regex extraction for free-text preferences, then learn how to do the feed correctly. We were students with no big budget, so I figured out how to cache, looked at how Instagram handled scrolling, and implemented that in our app.",
          whyThisScore:
            "This has real implementation detail, constraints, and a practical product outcome. It is strong applied problem solving, but it is not clearly novel or exceptional enough to anchor a 4.",
        },
      ],
      "4": [
        {
          id: "problem_solving_4_frontier_agent_reasoning_depth",
          source: "weave_human_ps4_label_real_high_end_pattern",
          score: 4,
          label: "Exceptional frontier technical depth plus personal implementation ownership.",
          answerExcerpt:
            "The candidate had PhD-level ML depth and described building agentic coding systems with profile files, prompt tuning, RAG database access, compile checks, reasoning over memory, and agent workflows around technology that did not already exist as a simple wrapper.",
          whyThisScore:
            "Use 4 when the answer shows unusual technical depth or novelty plus direct ownership. Public validation is helpful but not required; the transcript itself can clear the highest bar when the work is frontier, deeply technical, and implemented rather than merely described.",
        },
      ],
    },
    agency: {
      "1": [
        {
          id: "agency_1_no_non_computer_hack_answer",
          source: "weave_user_provided_chris_agency1",
          score: 1,
          label: "Prompt was asked, but the candidate could not provide a system-hack answer.",
          answerExcerpt:
            "Nothing is jumping to mind right now that I feel like I can answer in the next minute. Yeah, I mean, nothing is jumping to mind.",
          whyThisScore:
            "This is not a neutral missing-question case. The question was asked and the candidate had no example, so the observed answer gives weak agency signal rather than the neutral default.",
        },
      ],
      "2": [
        {
          id: "agency_2_trivial_or_not_a_system_hack",
          source: "weave_top12_disagreement_julia_agency2",
          score: 2,
          label: "Trivial rule-bending or generic behavior without meaningful system leverage.",
          answerExcerpt:
            "Maybe sharing a Netflix password. Definitely guilty of that. I do not have a record of breaking too many rules, maybe as a kid.",
          whyThisScore:
            "This answers the prompt, but the example is too trivial to show unusual agency. It does not demonstrate meaningful loophole exploitation, persistence, or manipulation of an institution or process.",
        },
      ],
      "3": [
        {
          id: "agency_3_behavioral_system_hack",
          source: "weave_top12_disagreement_john_agency3",
          score: 3,
          label: "Creative self or process hack that changes behavior but is not major rule-breaking.",
          answerExcerpt:
            "One way to drive ourselves to go was just show up at the gym. You can walk in the door and walk out if you want, but since we are already there, we might as well work out now.",
          whyThisScore:
            "This is a real behavioral system hack and shows initiative beyond normal compliance. It is not a 4 because it does not manipulate a high-stakes institution, loophole, or external process.",
        },
      ],
      "4": [
        {
          id: "agency_4_court_document_process_hack",
          source: "weave_top12_disagreement_aleksei_agency4",
          score: 4,
          label: "Concrete loophole or rule-breaking to make a human institution work.",
          answerExcerpt:
            "The courier filled the court document wrong and the court would reject it. I had tried Photoshop before as a kid, and because it was just a black-and-white paper, I used a photo editor to fix the fields.",
          whyThisScore:
            "This is a clean human-system hack: the candidate understood a bureaucratic failure mode, manipulated the paperwork process, and got the desired outcome through rule-bending rather than standard effort.",
        },
      ],
    },
    competitiveness: {
      "1": [
        {
          id: "competitiveness_1_no_win_loss_drive",
          source: "weave_user_provided_low_competitiveness_seed",
          score: 1,
          label: "No real competitive drive or cost when directly probed.",
          answerExcerpt:
            "I do not think so as much. I have had disagreements in the past, but I try to communicate what I think, see both sides, and ultimately live with the decision that is made.",
          whyThisScore:
            "This can be mature and useful behavior, but it does not show desire to win, emotional impact from losing, serious competition, sacrifice, or any cost paid for competitive drive.",
        },
      ],
      "2": [
        {
          id: "competitiveness_2_recreational_or_light_signal",
          source: "weave_calibration_syed_comp2",
          score: 2,
          label: "Some desire to win, but recreational or low-cost.",
          answerExcerpt:
            "I used to play Valorant a lot and somehow used friends' accounts to get Valorant skins all the time, which led to some issues with friends.",
          whyThisScore:
            "There is some win-seeking and mild cost, but the answer does not show sustained training, elite rank, identity-level obsession, or a major sacrifice.",
        },
      ],
      "3": [
        {
          id: "competitiveness_3_deliberate_step_challenge",
          source: "weave_calibration_sahithi_comp3",
          score: 3,
          label: "Clear competition with deliberate effort and meaningful inconvenience.",
          answerExcerpt:
            "There is a stepathon challenge comparing who walks more steps a day. Someone in Singapore was covering around 37,000 steps, and I walked around a lake three times so I could do 40,000 steps and beat her in at least one day.",
          whyThisScore:
            "This shows active competitive behavior and deliberate extra effort to beat someone. It is below 4 because the cost is limited and does not dominate a major part of life.",
        },
      ],
      "4": [
        {
          id: "competitiveness_4_rank_grind_with_cost",
          source: "weave_top12_disagreement_danny_comp4",
          score: 4,
          label: "Consumed by winning to the point of physical or life cost.",
          answerExcerpt:
            "I was grinding 12 hours a day during COVID and was eating one meal a day. For Valorant I played 25 games in one day, around 13 or 14 hours, skipped meals, did not really sleep, hit Immortal, and then felt burnt out.",
          whyThisScore:
            "This is exactly the high-end pattern: sustained competitive obsession, explicit rank target, skipped meals and sleep, burnout, and a concrete win condition.",
        },
      ],
    },
    curious: {
      "1": [
        {
          id: "curious_1_asked_but_not_niche",
          source: "weave_user_provided_akshat_curious1",
          score: 1,
          label: "Prompt was asked, but the answer does not establish a niche obsession.",
          answerExcerpt:
            "The answer gave a school or practicum teamwork story about working with biologists and researchers, but did not identify a niche non-technical topic or show top-percentile knowledge.",
          whyThisScore:
            "This is a low curiosity score because the candidate answered a different question. The issue is not missing data; the observed answer does not show the requested kind of curiosity.",
        },
      ],
      "2": [
        {
          id: "curious_2_interest_without_depth",
          source: "weave_calibration_syed_curious2",
          score: 2,
          label: "General interest with limited depth or concrete action.",
          answerExcerpt:
            "I was very curious about understanding interreligious studies, which helps me understand what every other culture actually does and what people started believing.",
          whyThisScore:
            "This shows an interest area, but the answer stays broad and does not provide concrete independent work, unusual detail, retained expertise, or a convincing top-percentile claim.",
        },
      ],
      "3": [
        {
          id: "curious_3_active_local_current_affairs",
          source: "weave_calibration_sahithi_curious3",
          score: 3,
          label: "Active curiosity with follow-through, but not clear expert-level depth.",
          answerExcerpt:
            "It is my hobby to be on top of current affairs happening in my hometown or locality. Before anyone would know, I would gather the sources and ping the group saying this happened.",
          whyThisScore:
            "This has concrete action and repeat behavior, so it is above neutral. It is not a 4 because the topic and mechanics do not show obsessive expertise or deep niche mastery.",
        },
      ],
      "4": [
        {
          id: "curious_4_wasp_niche_expertise",
          source: "weave_top12_disagreement_julia_curious4",
          score: 4,
          label: "Niche, non-technical expertise with concrete retained detail.",
          answerExcerpt:
            "I learned a lot about wasps because I had a nest within my walls and had to figure out how to get rid of it, what kind of wasp it is, when they nest, how they nest, what can go wrong, and that the best moment is after dark when they are all in.",
          whyThisScore:
            "This is niche, action-backed, and specific. The candidate learned from a real problem, retained operational details, and can explain mechanics that most people would not know.",
        },
      ],
    },
  };
}

export function dimensionScoreAnchorCoverage(
  anchors: DimensionScoreAnchors,
): Record<EvaluationDimensionKey, readonly DimensionScoreAnchorScore[]> {
  return {
    problem_solving: scoreCoverage(anchors.problem_solving),
    agency: scoreCoverage(anchors.agency),
    competitiveness: scoreCoverage(anchors.competitiveness),
    curious: scoreCoverage(anchors.curious),
  };
}

function scoreCoverage(
  anchors: Record<DimensionScoreAnchorScoreKey, readonly DimensionScoreAnchor[]>,
): readonly DimensionScoreAnchorScore[] {
  return scoreKeys.flatMap((scoreKey) =>
    anchors[scoreKey].length > 0 ? [Number(scoreKey) as DimensionScoreAnchorScore] : [],
  );
}
