<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ChemEngStudio Engineering Terminology Policy
- **Keep chemical names, fluid labels, and process engineering technical terms in standard English** even in Korean UI mode (e.g., `Syngas`, `Mixed Fluid`, `Natural Gas / CH₄`, `Steam`, `Condensate`, `Brine`, `Dry Cl₂`, `Wet Cl₂`, `Reflux`, `Pinch`, `LMTD`, `Dew Point`, `Distillate`, `Bottoms`, `Off-Gas`).
- Solver-generated fluid/stream labels (`identifyFluidName`, `detectKeyConc`, etc.) must be emitted directly in standard English — do not hardcode Korean translations for chemical or process engineering terms.
- Localize only general UI chrome (buttons, navigation, helper descriptions, and user notices) via `isEn ? ... : ...`.
