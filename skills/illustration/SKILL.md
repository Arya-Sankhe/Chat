---
name: Illustration
description: Create a clean, labeled 16:9 Klui explainer from this conversation. Uses image-generation credits.
---

# Illustration

This file is documentation and planner source material. The host runs a dedicated planner and Image API; do not treat this file as a live system prompt.

## Purpose

Turn the current request and conversation into one 16:9 editorial illustration.

## Visual DNA

- One 16:9 scene. One metaphor. Not a comic strip or numbered panel sequence.
- Pure white background. No texture, gradient, shadow, or scenery.
- Sparse black hand-drawn line art with slightly uneven pen lines and lots of empty space.
- Restrained red, orange, and blue only, on handwritten notes and arrows.
- Klui is a cute rounded light-sky-blue squircle with tall navy oval eyes, a tiny smile, rosy cheeks, and short stubby legs. Slightly chubby and friendly. Never pitch-black. Never a lumpy black bean.
- Klui performs the central conceptual action and is never a corner decoration.
- Clean, memorable, and easy to understand in a few seconds.
- Not photorealistic, a poster, a slide, a UI, a comic strip, or a dense infographic.

## Labels

3–6 handwritten English labels (2–4 words each) with colored arrows pointing at parts of the metaphor. The rule-name sits on the object that enforces it. No numbered step headers. No Chinese characters or other Han glyphs.

## Language

All planner output, captions, and image prompts are English. Understand non-English source material, then translate the visual concept into English. Never include Han characters in planner output or image prompts. Call the character Klui.

## Workflow

1. Resolve the subject from the request and conversation, including references such as "above".
2. Invent one physical metaphor. Cause and effect live in the same scene. Short English labels/arrows name the parts.
3. Clarify only when neither the request nor the conversation identifies a subject.
4. If the user asks for a shot list or no generation yet, return a concise English shot list and do not generate.
5. Otherwise generate now. Re-invent the metaphor. Never copy an example composition.
