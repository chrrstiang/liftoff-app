import { Button, EmptyState, Screen, Section, Sheet, SheetInput, Text } from "@/components/ui";
import { describeApiError } from "@/lib/api/client";
import { fetchMaxes, refreshMaxes, setMaxOverride } from "@/lib/api/maxes";
import { useTheme } from "@/theme/useTheme";
import type { AthleteMax } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Stack, useLocalSearchParams } from "expo-router";
import { Dumbbell } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";

/** One athlete's maxes — the numbers percentage prescription resolves against.
 *
 * Coach-facing. Reads are wider than writes server-side (an athlete may read
 * their own), but nothing routes an athlete here yet, so this screen assumes a
 * coach and the API refuses anyone else.
 */
export default function MaxesScreen() {
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<AthleteMax | null>(null);
  const [draft, setDraft] = useState("");

  const { data: maxes, isLoading } = useQuery({
    queryKey: ["maxes", athleteId],
    queryFn: () => fetchMaxes(athleteId),
    enabled: !!athleteId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["maxes", athleteId] });
    // Prescribed loads are resolved server-side against these numbers, so every
    // workout read is stale the moment a max moves.
    void queryClient.invalidateQueries({ queryKey: ["workout"] });
  };

  const refresh = useMutation({
    mutationFn: () => refreshMaxes(athleteId),
    onSuccess: (result) => {
      invalidate();
      Alert.alert(
        "Maxes refreshed",
        result.refreshed === 0
          ? "No logged sets in the last four weeks could produce an estimate. A set needs a load and an RPE."
          : `Recomputed ${result.refreshed} ${result.refreshed === 1 ? "max" : "maxes"} from logged work.`,
      );
    },
    onError: (error) => Alert.alert("Could not refresh", describeApiError(error)),
  });

  const override = useMutation({
    mutationFn: ({ exerciseId, value }: { exerciseId: string; value: number | null }) =>
      setMaxOverride(athleteId, exerciseId, value),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
    onError: (error) => Alert.alert("Could not save", describeApiError(error)),
  });

  const openEditor = (max: AthleteMax) => {
    setEditing(max);
    setDraft(max.override_value !== null ? String(max.override_value) : "");
  };

  const saveOverride = () => {
    if (!editing) return;

    const trimmed = draft.trim();
    // An empty field clears the pin and hands control back to the derived number.
    // That is a real action, not a no-op, which is why it sends null rather than
    // closing the sheet.
    const value = trimmed === "" ? null : Number(trimmed);

    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      Alert.alert("Not a weight", "Enter a number, or leave it empty to clear the override.");
      return;
    }

    override.mutate({ exerciseId: editing.exercise_id, value });
  };

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: "Maxes", headerShown: true }} />

      <View className="px-6 pt-4">
        <Text variant="caption" tone="muted">
          Percentage prescriptions resolve against these. A max is derived from logged sets
          unless you pin one.
        </Text>
      </View>

      {isLoading ? (
        <View className="py-16">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : maxes && maxes.length > 0 ? (
        <Section label="Per exercise" className="mt-8 px-6">
          {maxes.map((max) => (
            <Pressable
              key={max.exercise_id}
              accessibilityRole="button"
              accessibilityLabel={`Edit max for ${max.exercise_name}`}
              onPress={() => openEditor(max)}
              className="border-t border-hairline py-4 active:opacity-60 dark:border-hairline-dark"
            >
              <View className="flex-row items-baseline justify-between">
                <Text variant="body" tone="ink" className="flex-1 pr-4">
                  {max.exercise_name}
                </Text>
                <Text variant="body" tone="ink">
                  {max.effective_value !== null ? `${round(max.effective_value)} kg` : "—"}
                </Text>
              </View>

              {/* Where the number came from. "180kg" alone can only be believed;
                  "180kg, estimated 12 Oct" can be argued with. */}
              <Text variant="caption" tone="muted" className="mt-1">
                {provenance(max)}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : (
        <View className="min-h-72 flex-1 py-16">
          <EmptyState
            icon={Dumbbell}
            title="No maxes yet"
            body="Maxes are estimated from logged sets that have both a load and an RPE. Refresh once this athlete has trained, or pin one by hand."
          />
        </View>
      )}

      <View className="px-6 pb-10 pt-8">
        <Button
          label={refresh.isPending ? "Refreshing" : "Refresh from logged sets"}
          block
          loading={refresh.isPending}
          disabled={refresh.isPending}
          onPress={() => refresh.mutate()}
        />
      </View>

      <Sheet
        visible={!!editing}
        title={editing?.exercise_name ?? "Max"}
        onCancel={() => setEditing(null)}
        onDone={saveOverride}
        doneLabel={override.isPending ? "Saving" : "Save"}
      >
        <SheetInput
          label="Pinned max (kg)"
          value={draft}
          onChangeText={setDraft}
          placeholder={
            editing?.computed_value !== null && editing?.computed_value !== undefined
              ? String(round(editing.computed_value))
              : "Not set"
          }
          keyboardType="decimal-pad"
        />
        <Text variant="caption" tone="muted" className="px-1 pt-3">
          {editing?.computed_value !== null && editing?.computed_value !== undefined
            ? `Leave empty to use the estimated ${round(editing.computed_value)} kg instead.`
            : "Leave empty to clear. Nothing has been estimated for this exercise yet."}
        </Text>
      </Sheet>
    </Screen>
  );
}

/** Loads are kilograms to one decimal — enough for 2.5kg plate maths, not so much
 * that a derived number pretends to millimetre precision. */
function round(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function provenance(max: AthleteMax): string {
  if (max.override_value !== null) {
    return max.computed_value !== null
      ? `Pinned by you · estimated ${round(max.computed_value)} kg`
      : "Pinned by you";
  }

  if (max.computed_value !== null && max.computed_at) {
    return `Estimated from logged sets · ${format(parseISO(max.computed_at), "d MMM")}`;
  }

  return "Not set";
}
