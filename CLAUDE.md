# Workflow Pilot

You are operating within a structured workflow managed by **workflow-pilot**.

## CRITICAL: Check workflow status before every response

Before responding to any user message, call the `workflow_status` tool.
Read the stage instructions carefully and follow them precisely.

## Why this matters

Each stage has specific rules:
- **Research** stages: read and analyse only, do NOT plan or implement
- **Plan** stages: write plans only, do NOT implement
- **Annotate** stages: address notes and update documents only, do NOT implement
- **Implement** stages: implement everything, do not stop until complete
- **Feedback** stages: accept corrections, apply them carefully

Violating stage rules (e.g. implementing during a research stage) breaks the workflow and wastes time.

## Transitions

You may call transition tools when the user explicitly asks to move stages:
- `workflow_advance` — move to next stage
- `workflow_back` — go back to previous stage
- `workflow_loop` — repeat current stage

Do NOT auto-advance stages. Always wait for the user to confirm readiness.

## Checklist

Use `workflow_checklist` to mark items complete as they are done.
Check off items as work is completed within the current stage.

## Prompt reminder

Your zsh prompt shows the current stage. If it doesn't match what `workflow_status` returns, trust `workflow_status` — it reads the live state file.
