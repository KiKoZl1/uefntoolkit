import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";
import {
  corsHeaders,
  createServiceClient,
  isAllowedImageUrl,
  json,
  normalizeText,
  resolveUser,
} from "../_shared/tgisThumbTools.ts";

type DownloadFile = {
  url: string;
  name: string;
};

function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = normalizeText(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const finalName = cleaned || fallback;
  return finalName.toLowerCase().endsWith(".png") ? finalName : `${finalName}.png`;
}

function sanitizeZipName(name: string, fallback: string): string {
  const cleaned = normalizeText(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const finalName = cleaned || fallback;
  return finalName.toLowerCase().endsWith(".zip") ? finalName : `${finalName}.zip`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createServiceClient();
    await resolveUser(req, service);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const zip = Boolean(body.zip ?? true);
    const zipNameRaw = normalizeText(body.zipName || "thumb_layers.zip");
    const filesInput = Array.isArray(body.files) ? body.files : [];
    const files: DownloadFile[] = filesInput
      .map((item, idx) => {
        const url = normalizeText((item as any)?.url);
        const name = sanitizeFileName(normalizeText((item as any)?.name), `layer_${idx + 1}.png`);
        return { url, name };
      })
      .filter((item) => item.url.startsWith("http"))
      .slice(0, 40);

    if (!files.length) return json({ success: false, error: "no_files" }, 400);
    for (const file of files) {
      if (!isAllowedImageUrl(file.url)) {
        return json({ success: false, error: "invalid_file_url" }, 400);
      }
    }

    const fetched = await Promise.all(files.map(async (file) => {
      const resp = await fetch(file.url);
      if (!resp.ok) throw new Error(`file_fetch_failed_${resp.status}:${file.name}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return {
        ...file,
        bytes,
      };
    }));

    if (!zip && fetched.length === 1) {
      return new Response(fetched[0].bytes, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${fetched[0].name}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const archive = new JSZip();
    for (const file of fetched) {
      archive.file(file.name, file.bytes);
    }
    const zipBytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const zipName = zipNameRaw.toLowerCase().endsWith(".zip") ? zipNameRaw : `${zipNameRaw}.zip`;

    return new Response(zipBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${sanitizeZipName(zipName, "thumb_layers.zip")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "unauthorized" ? 401 : 500;
    return json({ success: false, error: msg }, status);
  }
});
