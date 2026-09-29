// server/intelligence/GeminiAgent.js
import dotenv from 'dotenv';
dotenv.config({ path: './server/.env' });

import { GoogleGenAI } from '@google/genai';
import { toolDeclarations, toolHandlers } from '../tools/index.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `
You are the central marine-biology Intelligence Layer for the Ocean Pro ecosystem simulation.
Your job has TWO distinct stages, and the rules differ between them:

STAGE 1 — IDENTITY (must be grounded in tool evidence):
1. Interpret the assetName, tolerating typos/variants/common names (e.g. 'yelow_tnag.glb' -> 'Yellow Tang', 'sperm_whale.glb' -> 'Sperm Whale').
2. Call the tools (searchWoRMS, and FishBase/OBIS where relevant) to obtain authoritative taxonomy for that name.
3. Set identity.scientificName / taxonomy ONLY from what the tools support. Populate the full taxonomy chain (kingdom -> genus) that the tools return, and the AphiaID when available.
4. If the name is generic or maps to many species (e.g. 'shark', 'fish', 'octopus', 'whale' with no species qualifier) and the tools do NOT resolve a single species, set "ambiguous": true, leave scientificName null, and DO NOT invent a specific species. In that case also leave the species-specific biology (ecology/behaviorModel/morphology/conservationStatus) null.

STAGE 2 — BIOLOGY (only when a species is CONFIDENTLY identified in Stage 1):
5. Once a species is confidently identified (scientificName set, ambiguous=false), you SHOULD describe its biology. This is factual, widely-documented knowledge about a KNOWN species — it is exactly the "intelligence" this system needs, and it is NOT fabrication.
6. PREFER exact values the tools returned (e.g. FishBase depth range / length, OBIS depth & geographic distribution). Where the tools are silent, supply only WELL-ESTABLISHED, textbook facts about THAT species.
7. If you are not confident a specific detail is well-established for that species, set that field to null instead of guessing. NEVER invent precise numbers you are unsure of — prefer honest ranges (e.g. "typically 200–1000 m") or null. List anything uncertain in reasoning.uncertainties.
8. Record which authoritative sources actually informed the profile in the "sources" array (e.g. "World Register of Marine Species (WoRMS)", "FishBase", "OBIS"), plus a general-knowledge note when Stage-2 facts came from established literature rather than a tool.
9. Extract concrete tool hits into the "evidence" array, preserving source IDs and URLs.
10. Your output MUST be a single JSON object matching the structure below (no markdown, no commentary).

The JSON output MUST match this structure (use null for any field you cannot support; strings unless noted):
{
    "identity": {
        "displayName": "string (human-friendly common name)",
        "commonName": "string | null",
        "scientificName": "string | null",
        "aphiaId": "number | null",
        "confidence": "number 0-1",
        "ambiguous": "boolean"
    },
    "taxonomy": {
        "kingdom": "string | null",
        "phylum": "string | null",
        "className": "string | null",
        "order": "string | null",
        "family": "string | null",
        "genus": "string | null"
    },
    "evidence": [
        { "source": "string", "field": "string", "value": "string", "sourceId": "string", "url": "string" }
    ],
    "ecology": {
        "habitat": "string | null (e.g. 'Open ocean / deep pelagic and mesopelagic')",
        "depthRange": "string | null (e.g. '0–2035 m, typically 200–1000 m')",
        "distribution": "string | null (geographic range)",
        "diet": "string | null (e.g. 'Carnivore — squid and deep-sea fish')"
    },
    "behaviorModel": {
        "movementType": "string | null (locomotion style)",
        "schooling": "boolean | null",
        "socialBehavior": "string | null (e.g. 'Social — lives in matrilineal pods')",
        "activityPattern": "string | null (diurnal / nocturnal / crepuscular)",
        "verticalMovement": "string | null (e.g. 'Deep-diving forager' / 'diel vertical migration')",
        "predator": ["string"],
        "prey": ["string"],
        "threatResponse": "string | null"
    },
    "morphology": {
        "size": "string | null (typical adult size, e.g. '11–16 m, up to ~57 t')",
        "lengthMeters": "number | null (typical adult body length in metres, for scale)"
    },
    "conservationStatus": "string | null (IUCN status if well established)",
    "reproduction": "string | null",
    "interestingFact": "string | null (one well-established, engaging fact — never mention the asset/filename)",
    "reasoning": {
        "summary": "string",
        "assumptions": ["string"],
        "uncertainties": ["string"]
    },
    "sources": ["string"]
}
`;

export async function researchSpecies(assetName) {
  const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.6-flash', 'gemini-flash-latest'].filter(Boolean))];
  let lastError = null;

  for (const model of models) {
    try {
      let chat = ai.chats.create({
        model: model,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          tools: [{ functionDeclarations: toolDeclarations }]
        }
      });

  const prompt = `Research the species associated with the asset: '${assetName}'. Call the necessary tools, evaluate the evidence, and output the final Knowledge Profile in the requested JSON structure.`;
  
  let response = await chat.sendMessage({ message: prompt });
  
  const debugInfo = {
    assetName,
    toolsCalled: []
  };

  // Handle function calling loop
  while (response.functionCalls && response.functionCalls.length > 0) {
    const functionResponses = [];
    
    for (const call of response.functionCalls) {
      if (toolHandlers[call.name]) {
        try {
          const result = await toolHandlers[call.name](call.args);
          
          debugInfo.toolsCalled.push({
            tool: call.name,
            args: call.args,
            resultSummary: typeof result === 'object' ? JSON.stringify(result).substring(0, 150) + '...' : result
          });

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: result
            }
          });
        } catch (e) {
          debugInfo.toolsCalled.push({
            tool: call.name,
            args: call.args,
            error: e.message
          });

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { error: e.message }
            }
          });
        }
      }
    }
    
    response = await chat.sendMessage({ message: functionResponses });
  }

      // Final response should be JSON.
      let text = response.text || "";
      text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      try {
        const profile = JSON.parse(text);
        profile._debug = debugInfo;
        console.log(`[GeminiAgent] ${model} resolved '${assetName}' via ${debugInfo.toolsCalled.length} live tool call(s) → ${profile?.identity?.scientificName || profile?.identity?.displayName || 'ambiguous'}`);
        return profile;
      } catch (e) {
        throw new Error("Gemini returned invalid JSON: " + text);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[GeminiAgent] Model ${model} failed for ${assetName}:`, err.message);
    }
  }

  throw lastError || new Error(`All intelligence models failed for ${assetName}`);
}

