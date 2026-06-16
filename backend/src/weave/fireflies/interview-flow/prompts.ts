export const EXTRACTION_PROMPT_TEMPLATE = String.raw`You are analyzing one 15-minute interview transcript.

Goal:
Extract the interviewer's question flow, verbatim question wording, follow-up behavior, and likely reasoning behind each question.

Important:
- Do not invent questions.
- Use only evidence from the transcript.
- Preserve verbatim interviewer questions exactly when possible.
- Distinguish between what the interviewer explicitly asked and your inferred reasoning.
- If reasoning is uncertain, say so.
- Treat the interviewer as "INTERVIEWER" and the candidate as "CANDIDATE".

Input:
<TRANSCRIPT>
{{TRANSCRIPT_TEXT}}
</TRANSCRIPT>

Return valid JSON only, with this schema:

{
  "interview_metadata": {
    "candidate_name": null,
    "interview_duration_minutes": null,
    "overall_interview_structure": [
      {
        "stage_name": "string",
        "start_time": "MM:SS or null",
        "end_time": "MM:SS or null",
        "summary": "string"
      }
    ]
  },
  "question_events": [
    {
      "event_id": "Q001",
      "timestamp": "MM:SS or null",
      "verbatim_question": "exact interviewer wording",
      "normalized_question": "clean canonical version of the question",
      "question_type": "intro | background | project_deep_dive | technical_depth | problem_solving | agency | ownership | motivation | competitiveness | clarification | follow_up | wrap_up | other",
      "interview_stage": "string",
      "candidate_answer_summary_before_question": "what the candidate had just said that triggered this question, or null",
      "candidate_answer_type_before_question": "project_description | vague_claim | technical_claim | impact_claim | teamwork_claim | obstacle | motivation_claim | uncertainty | personal_background | other | null",
      "trigger_for_question": {
        "explicit_trigger": "specific phrase or idea from candidate that appears to trigger this question, or null",
        "inferred_trigger": "your best inference, or null",
        "confidence": "low | medium | high"
      },
      "likely_interviewer_reasoning": {
        "primary_signal_sought": "string",
        "reasoning": "short explanation of why the interviewer likely asked this",
        "confidence": "low | medium | high"
      },
      "follow_up_relationship": {
        "is_follow_up": true,
        "follows_event_id": "Q000 or null",
        "follow_up_depth": 0,
        "what_it_probes_deeper_on": "string or null"
      },
      "candidate_response_summary": "short summary of candidate answer after this question",
      "next_interviewer_move": {
        "next_event_id": "Q002 or null",
        "move_type": "probe_deeper | switch_topic | clarify | challenge | validate | wrap_up | other | null",
        "why_likely": "string or null"
      }
    }
  ],
  "observed_patterns": {
    "repeated_question_variants": [
      {
        "canonical_question": "string",
        "verbatim_variants": ["string"],
        "count": 0
      }
    ],
    "probing_patterns": [
      {
        "pattern_name": "string",
        "description": "string",
        "example_event_ids": ["Q001"]
      }
    ],
    "signals_interviewer_appears_to_seek": [
      {
        "signal": "string",
        "evidence": "string",
        "confidence": "low | medium | high"
      }
    ]
  },
  "flowchart_edges": [
    {
      "from_event_id": "Q001",
      "to_event_id": "Q002",
      "condition": "what candidate answer or interview state caused this transition",
      "edge_type": "normal_sequence | conditional_probe | topic_shift | clarification | wrap_up"
    }
  ],
  "quality_notes": {
    "missing_timestamps": true,
    "ambiguous_questions": ["string"],
    "places_where_model_is_uncertain": ["string"]
  }
}`;

export const AGGREGATION_PROMPT_TEMPLATE = String.raw`You are analyzing structured outputs from 50 interview transcripts.

Goal:
Build a data flowchart of the interviewer's actual question behavior across interviews.

You will receive per-transcript JSON extractions. Your job is to aggregate them into:
1. Common interview stages
2. Canonical questions
3. Verbatim variants
4. Follow-up triggers
5. Conditional branching logic
6. Estimated frequency of each path
7. Light reasoning for why the interviewer asks each question

Important:
- Do not invent behavior not supported by the transcript extractions.
- Separate observed facts from inferred reasoning.
- Preserve representative verbatim examples.
- Prefer percentages/counts over vague claims.
- If a pattern appears in fewer than 3 interviews, mark it as low-frequency.
- If a follow-up trigger is unclear, say so.

Input:
<EXTRACTIONS_JSON>
{{ALL_TRANSCRIPT_EXTRACTIONS_JSON}}
</EXTRACTIONS_JSON>

Return valid JSON only, with this schema:

{
  "global_interview_flow": {
    "stages": [
      {
        "stage_id": "S1",
        "stage_name": "string",
        "typical_position": "early | middle | late",
        "appears_in_n_interviews": 0,
        "appears_in_percent": 0,
        "purpose": "string"
      }
    ]
  },
  "canonical_questions": [
    {
      "question_id": "CQ001",
      "canonical_question": "string",
      "stage_id": "S1",
      "question_type": "string",
      "appears_in_n_interviews": 0,
      "appears_in_percent": 0,
      "representative_verbatim_variants": [
        {
          "text": "exact wording",
          "source_transcript_id": "string or null"
        }
      ],
      "common_preceding_contexts": [
        {
          "context_type": "string",
          "description": "string",
          "frequency_estimate": "string"
        }
      ],
      "likely_reasoning": {
        "primary_signal_sought": "string",
        "explanation": "string",
        "confidence": "low | medium | high"
      }
    }
  ],
  "follow_up_logic": [
    {
      "parent_question_id": "CQ001",
      "follow_up_question_id": "CQ002",
      "trigger_condition": "candidate answer pattern that tends to cause this follow-up",
      "appears_in_n_interviews": 0,
      "appears_in_percent": 0,
      "example_verbatim_follow_ups": ["string"],
      "reasoning": "why this follow-up likely happens",
      "confidence": "low | medium | high"
    }
  ],
  "flowchart": {
    "nodes": [
      {
        "id": "CQ001",
        "label": "short label",
        "full_question": "canonical question",
        "stage": "string",
        "frequency_percent": 0
      }
    ],
    "edges": [
      {
        "from": "CQ001",
        "to": "CQ002",
        "condition": "string",
        "edge_label": "string",
        "frequency_percent": 0,
        "confidence": "low | medium | high"
      }
    ]
  },
  "mermaid_flowchart": "flowchart TD\n...",
  "summary": {
    "top_level_interview_strategy": "string",
    "most_common_questions": ["string"],
    "most_common_probe_triggers": ["string"],
    "signals_interviewer_prioritizes": ["string"],
    "surprising_patterns": ["string"],
    "low_confidence_findings": ["string"]
  }
}`;
