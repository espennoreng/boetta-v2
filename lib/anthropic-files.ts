import Anthropic from "@anthropic-ai/sdk";
import { fetchObjectStream } from "./r2";

const client = new Anthropic();

/**
 * Stream an R2 object into the Anthropic Files API and return the file_id.
 * The Files API holds a copy keyed by file_id that the model reads when an
 * event references it. R2 remains the canonical store.
 */
export async function uploadObjectToFiles(params: {
  r2Key: string;
  mime: string;
  originalName: string;
}): Promise<string> {
  const { body } = await fetchObjectStream({ key: params.r2Key });

  // The SDK accepts a Web ReadableStream via the `toFile` helper (which is
  // also exposed as Anthropic.toFile). A Web ReadableStream is async-iterable
  // in Bun/Node, satisfying the AsyncIterable<BlobLikePart> overload.
  const file = await client.beta.files.upload({
    file: await Anthropic.toFile(body as unknown as AsyncIterable<Uint8Array>, params.originalName, {
      type: params.mime,
    }),
  });

  return file.id;
}
