import { supabase } from "@/lib/supabase";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";

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

  const fileExt = uri.split(".").pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `avatars/${userId}/${fileName}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(filePath, arrayBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (error) {
    console.error("Error uploading avatar:", error);
    throw error;
  }

  return filePath;
}

export async function updateUserAvatar(userId: string, avatarUrl: string) {
  const { error } = await supabase
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);

  if (error) throw error;
}

export async function uploadImageMessage(uri: string, conversationId: string) {
  try {
    const file = new File(uri);
    const arrayBuffer = await file.arrayBuffer();

    const fileExt = uri.split(".").pop()?.toLowerCase() || "jpg";
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${conversationId}/${fileName}`;

    const { error } = await supabase.storage
      .from("conversations")
      .upload(filePath, arrayBuffer, {
        contentType: `image/${fileExt}`,
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
