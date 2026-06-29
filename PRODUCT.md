# Product

## Register

product

## Users

Hackathon judges, teachers, training teams, course creators, knowledge-base owners, product teams, and growth teams who need static content to become easier to remember.

## Product Purpose

入境·GameCraft turns any text into a playable learning game.

The user pastes ordinary content such as a lesson, SOP, product explanation, activity rule, video transcript, or onboarding material. 入境·GameCraft extracts key concepts and traps, chooses the best playable skeleton, lets the user play through the generated interaction, and produces proof that the content was actively processed.

The Hackathon product shape is one web page:

```text
Paste text -> Agent picks skeleton -> Play -> Memory proof
```

This is not a study planner, not a quiz generator, and not a two-sided app. The creator and player views are combined into one demo stage so judges can understand the product in seconds.

## Core Functions

- Text input and sample switching.
- Content signal extraction.
- Agent skeleton selection with reasons.
- Card Stack Builder with drag, stack, combo, trap feedback, and proof.
- Misconception Raid with Phaser Boss, scan/break/repair actions, HP, projectiles, particles, and proof.
- Playable level preview.
- Memory score.
- Play proof event feed.
- Proof/review state after play.

## Brand Personality

Luminous, playful, fast, and credible. The product should feel like a high-end learning game generator: more memorable than a SaaS dashboard, more structured than a pure visual demo.

## Anti-references

- Generic AI dashboard.
- Study planner as the primary product.
- Long-form admin workspace.
- Separate creator app plus player app in the Hackathon version.
- Pure screenshot/image background with invisible hotspots.
- Agent generating arbitrary game source code live.
- Old Image2 reactor pages and historical QA screenshots.

## Design Principles

- One screen, one magic moment: text becomes a playable memory level.
- Make the playable artifact visible immediately.
- Keep controls real DOM, not bitmap hotspots.
- Show the memory loop: choice, feedback, score, proof.
- Use mature game assets with clear local license evidence.
- Use motion for generation and state change, not decoration.
- Desktop first for judging; mobile must remain readable as a stacked flow.

## Competitive Position

StudyQuest is the closest category anchor: notes and materials become study games. 入境·GameCraft should be broader and more proof-oriented:

```text
StudyQuest: notes -> study games
入境·GameCraft: any text/content -> playable memory experience -> play proof
```

Nexus is useful as a Hackathon reference for lesson-to-game pipelines, but it appears to be a project rather than a polished public product. 入境·GameCraft should avoid live game-code generation risk by keeping stable templates and structured game data.

## Accessibility & Inclusion

Target WCAG AA contrast, visible focus states, keyboard-reachable buttons, reduced-motion fallbacks, and no horizontal overflow on common desktop and mobile viewports.
