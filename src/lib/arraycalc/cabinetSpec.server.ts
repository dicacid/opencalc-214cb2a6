/* Server-only helper: turn a pasted datasheet block or an uploaded PDF into
   cabinet spec fields, using the Lovable AI gateway. */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM = `You extract loudspeaker specifications from manufacturer datasheets.
Return ONLY a JSON object with these keys (omit any you cannot find, never guess wildly):
key (short model code, e.g. "KSL8"), name, manufacturer,
kind ("array" | "point" | "sub"),
h, w, d (metres), kg (weight),
hCov (nominal horizontal coverage in degrees), vCov (vertical coverage degrees, point source only),
splayMin, splayMax (degrees between adjacent cabinets, arrays only),
qtyMax (max cabinets per hang), mounting ("flown" | "stacked" | "stack-only"),
lowCut (lower -3/-10 dB frequency in Hz), hiCut (upper frequency in Hz),
ampCh (amplifier channels per cabinet), ampModel,
maxSpl (single published SPLmax figure in dB),
spl31.5, spl63, spl125, spl250, spl500, spl1000, spl2000, spl4000, spl8000
(max SPL per octave band in dB, only if the datasheet publishes a curve or table).
Convert mm/cm to metres and lbs to kg. No prose, no markdown fences.`;

export interface ExtractInput {
  text?: string | undefined;
  filename?: string | undefined;
  fileData?: string | undefined; // data:<mime>;base64,...
}

export async function extractSpecFields(input: ExtractInput): Promise<Record<string, unknown>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI extraction is not available on this project.");

  const content: Record<string, unknown>[] = [
    { type: "text", text: "Extract the loudspeaker specification as JSON." },
  ];
  if (input.text?.trim()) content.push({ type: "text", text: input.text.slice(0, 20000) });
  if (input.fileData) {
    content.push({
      type: "file",
      file: { filename: input.filename || "datasheet.pdf", file_data: input.fileData },
    });
  }

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
    }),
  });

  if (res.status === 429) throw new Error("Rate limit reached — try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted for this workspace.");
  if (!res.ok) throw new Error(`Extraction failed (${res.status}).`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not read a specification from that document.");
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error("Extraction returned malformed data.");
  }
}
