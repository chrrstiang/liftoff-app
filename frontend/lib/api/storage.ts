import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";

/** Image upload.
 *
 * ⚠️ **This module still talks to Supabase, on purpose.** Only *Postgres* moved to
 * RDS; the two storage buckets are independent of that and stay where they are.
 * Moving them means the backend minting signed upload URLs and the client PUTting
 * directly — never proxying binary through Fargate — which is its own piece of work.
 *
 * What did have to move is the one line that wrote a **table**: `updateUserAvatar`
 * updated `users.avatar_url` with the anon key. That is a Postgres write and now
 * goes through the API.
 *
 * Both buckets remain world-readable by URL. That is pre-existing and unchanged
 * here, but it is worth not forgetting: an avatar path is effectively public.
 */

/** Extension → MIME, because both uploads were getting it wrong in different ways.
 *
 * `uploadAvatar` hardcoded `image/jpeg` while taking the extension from the
 * picked URI, so a PNG was stored announcing itself as a JPEG.
 * `uploadImageMessage` built `image/${ext}`, which turns the commonest extension
 * of all into `image/jpg` — a string that is not a MIME type. The real one is
 * `image/jpeg`; `jpg` is the DOS-era filename, and nothing ever registered it.
 *
 * Both buckets are served with the stored content type, so a wrong one is what a
 * browser or an `expo-image` cache sees. iOS also hands back `.HEIC` in caps from
 * the picker, hence the lowercasing.
 */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** The extension, lowercased, or "jpg" when the URI carries none. */
function imageExtension(uri: string): string {
  const withoutQuery = uri.split("?")[0];
  const ext = withoutQuery.split(".").pop()?.toLowerCase();

  // A URI with no dot returns the whole string from `pop`, so the map lookup is
  // what decides, not the presence of a dot.
  return ext && ext in IMAGE_CONTENT_TYPES ? ext : "jpg";
}

/** Falls back to JPEG rather than to `application/octet-stream`: an unknown
 * extension off an image picker is far more likely a JPEG than a download. */
function imageContentType(extension: string): string {
  return IMAGE_CONTENT_TYPES[extension] ?? "image/jpeg";
}

export async function uploadAvatar(userId: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });

  if (result.canceled) return null;

  const uri = result.assets[0].uri;

  const response = await fetch(uri);
  const blob = await response.blob();
  const arrayBuffer = await new Response(blob).arrayBuffer();

  const fileExt = imageExtension(uri);
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `avatars/${userId}/${fileName}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(filePath, arrayBuffer, {
      contentType: imageContentType(fileExt),
      upsert: true,
    });

  if (error) {
    console.error("Error uploading avatar:", error);
    throw error;
  }

  return filePath;
}

/** Points the caller's profile at an uploaded avatar.
 *
 * `userId` is gone from the signature — the API scopes the update to the token
 * holder. The previous version took an id and wrote that row, so it could set any
 * user's avatar to any path.
 */
export async function updateUserAvatar(avatarUrl: string) {
  await api.patch("/users/profile", { avatar_url: avatarUrl });
}

export async function uploadImageMessage(uri: string, conversationId: string) {
  try {
    const file = new File(uri);
    const arrayBuffer = await file.arrayBuffer();

    const fileExt = imageExtension(uri);
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${conversationId}/${fileName}`;

    const { error } = await supabase.storage
      .from("conversations")
      .upload(filePath, arrayBuffer, {
        contentType: imageContentType(fileExt),
      });

    if (error) {
      throw error;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("conversations").getPublicUrl(filePath);

    return {
      url: publicUrl,
      path: filePath,
    };
  } catch (error) {
    console.error("Error uploading image:", error);
    throw error;
  }
}
