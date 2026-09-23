import {
  Button,
  Chip,
  QueryError,
  Screen,
  Section,
  SelectSheet,
  SheetInput,
  SheetRow,
  Text,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchAthleteCompeting,
  updateAthleteProfile,
} from "@/lib/api/athlete";
import { describeApiError } from "@/lib/api/client";
import { updateUserProfile } from "@/lib/api/users";
import {
  fetchDivisions,
  fetchFederations,
  fetchWeightClasses,
} from "@/lib/reference";
import { useTheme } from "@/theme/useTheme";
import { GENDERS } from "@/types";
import type {
  AthleteCompetingPatch,
  Division,
  ProfilePatch,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";

const USERNAME_PATTERN = /^[a-z0-9._]+$/;

/** Ages copy for a division, which may be open-ended at either end. */
function divisionAges(div: Division) {
  if (!div.minimum_age) return `Ages ${div.maximum_age} and under`;
  if (!div.maximum_age) return `Ages ${div.minimum_age} and over`;
  return `Ages ${div.minimum_age} – ${div.maximum_age}`;
}

/** Editing the profile the Profile tab could previously only display.
 *
 * `PATCH /users/profile` has worked since it shipped and the only field the app
 * ever sent it was `avatar_url`, so a typo'd username at signup meant
 * re-registering. This screen is the form for the rest of it, and for the
 * athlete-side reference data behind `PATCH /athlete/profile`.
 *
 * Two things here are not incidental:
 *
 * 1. **Only changed fields are sent.** `@IsUnique('users','username')` on the
 *    backend matches the caller's own row, so re-sending the username you already
 *    have is rejected as a collision with yourself — a known limitation kept on
 *    purpose, and "the client only sends changed fields" is exactly why nothing
 *    hits it. A form that PATCHed everything would 400 on every save.
 * 2. **The `users` write lands before the `athletes` write.** Gender lives on
 *    `users`, weight classes are gendered, and the API validates a weight class
 *    against the *stored* gender rather than anything in the request. Reversing
 *    the order would validate a new weight class against the old gender.
 */
export default function EditProfile() {
  const { user, profile, fetchProfile } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const isAthlete = Boolean(profile?.is_athlete);

  // Seeded directly from the context rather than through an effect: the auth gate
  // in app/_layout.tsx will not route into (app) until the profile has loaded, so
  // it is already here on first render.
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "");

  const [federationId, setFederationId] = useState<string | null>(null);
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [weightClassId, setWeightClassId] = useState<string | null>(null);

  const [showFederationSheet, setShowFederationSheet] = useState(false);
  const [showDivisionSheet, setShowDivisionSheet] = useState(false);
  const [showWeightClassSheet, setShowWeightClassSheet] = useState(false);

  // The athlete row's current ids, which are what the athlete patch is diffed
  // against. `fetchAthleteProfile` returns resolved names instead, and a name
  // cannot be turned back into an id unambiguously.
  const {
    data: competing,
    isLoading: loadingCompeting,
    error: competingError,
    refetch: refetchCompeting,
  } = useQuery({
    queryKey: ["athlete", "competing", user?.id],
    queryFn: () => fetchAthleteCompeting(user!.id),
    enabled: Boolean(user?.id) && isAthlete,
  });

  // One-shot seed. Without the ref, a background refetch would discard whatever
  // the user had picked but not yet saved.
  const seeded = useRef(false);
  useEffect(() => {
    if (!competing || seeded.current) return;
    seeded.current = true;
    setFederationId(competing.federation_id);
    setDivisionId(competing.division_id);
    setWeightClassId(competing.weight_class_id);
  }, [competing]);

  const { data: federations = [] } = useQuery({
    queryKey: ["reference", "federations"],
    queryFn: fetchFederations,
    enabled: isAthlete,
    staleTime: Infinity,
  });

  const { data: divisions = [] } = useQuery({
    queryKey: ["reference", "divisions", federationId],
    queryFn: () => fetchDivisions(federationId!),
    enabled: Boolean(federationId),
    staleTime: Infinity,
  });

  const { data: weightClasses = [] } = useQuery({
    queryKey: ["reference", "weight-classes", federationId, gender],
    queryFn: () => fetchWeightClasses(federationId!, gender),
    enabled: Boolean(federationId) && Boolean(gender),
    staleTime: Infinity,
  });

  // Selection is held as ids and the rows are looked up for display, rather than
  // storing whole objects — that way there is no window where a selected id has
  // arrived but its list has not.
  const federation = federations.find((f) => f.id === federationId) ?? null;
  const division = divisions.find((d) => d.id === divisionId) ?? null;
  const weightClass = weightClasses.find((w) => w.id === weightClassId) ?? null;

  /** Gender drives which weight classes exist, so changing it has to drop the
   * current one. Leaving it would put a men's class on a women's profile, which
   * the API rejects anyway — better to make it visibly unset here. */
  const chooseGender = (next: string) => {
    if (next === gender) return;
    setGender(next);
    setWeightClassId(null);
  };

  /** Divisions and weight classes both belong to a federation, so neither
   * survives changing it. */
  const chooseFederation = (nextId: string) => {
    if (nextId === federationId) return;
    setFederationId(nextId);
    setDivisionId(null);
    setWeightClassId(null);
  };

  const userPatch = useMemo<ProfilePatch>(() => {
    const patch: ProfilePatch = {};
    if (!profile) return patch;

    const nextFirst = firstName.trim();
    const nextLast = lastName.trim();
    const nextUsername = username.trim();

    if (nextFirst !== profile.first_name) patch.first_name = nextFirst;
    if (nextLast !== profile.last_name) patch.last_name = nextLast;
    if (nextUsername !== profile.username) patch.username = nextUsername;
    if (gender !== profile.gender) patch.gender = gender;

    return patch;
  }, [profile, firstName, lastName, username, gender]);

  const athletePatch = useMemo<AthleteCompetingPatch>(() => {
    const patch: AthleteCompetingPatch = {};
    if (!isAthlete || !competing) return patch;

    if (federationId !== competing.federation_id) {
      patch.federation_id = federationId;
    }
    if (divisionId !== competing.division_id) patch.division_id = divisionId;
    if (weightClassId !== competing.weight_class_id) {
      patch.weight_class_id = weightClassId;
    }

    return patch;
  }, [isAthlete, competing, federationId, divisionId, weightClassId]);

  const hasChanges =
    Object.keys(userPatch).length > 0 || Object.keys(athletePatch).length > 0;

  /** The client-side half of the DTO's rules, so the common mistakes are caught
   * without a round trip. Anything subtler still comes back from the API, and
   * `describeApiError` renders its per-field messages. */
  const firstProblem = (): string | null => {
    if (!firstName.trim()) return "First name cannot be empty.";
    if (!lastName.trim()) return "Last name cannot be empty.";

    const next = username.trim();
    if (next.length < 3 || next.length > 30) {
      return "Username must be between 3 and 30 characters.";
    }
    if (!USERNAME_PATTERN.test(next)) {
      return "Username can only use lowercase letters, numbers, dots and underscores.";
    }

    if (!gender) return "Pick a gender.";
    return null;
  };

  /** Re-reads both halves of the profile. The context holds the `users` side;
   * every `["athlete", ...]` cache holds the other, including this screen's own
   * seed and the roster / program views. */
  const refresh = async () => {
    await fetchProfile();
    await queryClient.invalidateQueries({ queryKey: ["athlete"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      // Order is deliberate — see the note on this component.
      if (Object.keys(userPatch).length > 0) {
        await updateUserProfile(userPatch);
      }
      if (Object.keys(athletePatch).length > 0) {
        await updateAthleteProfile(athletePatch);
      }
    },
    onSuccess: async () => {
      await refresh();
      router.back();
    },
    onError: async (error) => {
      // ⚠️ **Refresh on failure too.** These are two requests, not a
      // transaction: the `users` PATCH can land and the `athletes` one fail on a
      // bad federation/division combination. Leaving `profile` stale would then
      // make the diff re-send a username that has *already* been saved — and
      // `@IsUnique('users','username')` matches the caller's own row, so that is
      // a 400 every time and Save would never succeed again. Re-reading first is
      // what keeps a partial save recoverable.
      await refresh();
      Alert.alert(
        "Error",
        describeApiError(error, "Failed to save your profile."),
      );
    },
  });

  const handleSave = () => {
    const problem = firstProblem();
    if (problem) {
      Alert.alert("Check your details", problem);
      return;
    }
    save.mutate();
  };

  const header = (
    <View className="flex-row items-center gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={() => router.back()}
      >
        <ChevronLeft size={24} strokeWidth={2} color={colors.ink} />
      </Pressable>

      <Text variant="title" tone="ink">
        Edit profile
      </Text>
    </View>
  );

  /* Failing silently here is worse than elsewhere: the form would render with
     federation, division and weight class blank, and saving would then look like
     the user clearing them rather than the app never having loaded them. */
  if (isAthlete && competingError) {
    return (
      <Screen>
        <View className="px-6 pt-4">{header}</View>
        <QueryError
          error={competingError}
          onRetry={() => void refetchCompeting()}
          fallback="Could not load your competing details."
        />
      </Screen>
    );
  }

  if (isAthlete && loadingCompeting) {
    return (
      <Screen>
        <View className="px-6 pt-4">{header}</View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll dismissKeyboard>
      <View className="w-full max-w-md self-center px-6 pb-10 pt-4">
        {header}

        <Text variant="body" tone="muted" className="mt-2">
          Only what you change is sent.
        </Text>

        <Section label="General" className="mt-8">
          <SheetInput
            label="First name"
            placeholder="John"
            value={firstName}
            onChangeText={setFirstName}
          />
          <SheetInput
            label="Last name"
            placeholder="Doe"
            value={lastName}
            onChangeText={setLastName}
          />
          <SheetInput
            label="Username"
            placeholder="johndoe"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
          {/* Email is the identity provider's and date of birth is not editable
              here: the API never takes email from the client, and a birth date is
              a competition eligibility fact rather than a preference. */}
          <SheetRow label="Email" value={profile?.email ?? user?.email} />
        </Section>

        <Section label="Gender" className="mt-8">
          <View className="flex-row flex-wrap gap-2 py-3">
            {GENDERS.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={gender === option}
                onPress={() => chooseGender(option)}
              />
            ))}
          </View>
        </Section>

        {/* Gated on `competing` rather than on `isAthlete` alone. The athlete patch
            is diffed against those ids, so without them a pick would produce an
            empty patch and Save would silently do nothing — better to say the
            details are unavailable than to offer controls that don't work. An
            athlete reaches this only if the read failed: createUserProfile always
            writes the `athletes` row when is_athlete is set. */}
        {isAthlete && !competing ? (
          <View className="mt-8">
            <Text variant="overline" tone="muted" className="px-1">
              Competing
            </Text>
            <Text variant="body" tone="muted" className="mt-2 px-1">
              Your competing details could not be loaded, so they cannot be
              edited right now.
            </Text>
          </View>
        ) : null}

        {isAthlete && competing ? (
          <Section label="Competing" className="mt-8">
            <SheetRow
              label="Federation"
              value={federation ? (federation.name ?? federation.code) : null}
              placeholder="Select"
              chevron
              onPress={() => setShowFederationSheet(true)}
            />
            <SheetRow
              label="Division"
              value={division?.name}
              placeholder={federationId ? "Select" : "Pick a federation"}
              chevron
              disabled={!federationId}
              onPress={() => setShowDivisionSheet(true)}
            />
            <SheetRow
              label="Weight class"
              value={weightClass ? `${weightClass.name} kg` : null}
              placeholder={
                !federationId
                  ? "Pick a federation"
                  : !gender
                    ? "Pick a gender"
                    : "Select"
              }
              numeric
              chevron
              disabled={!federationId || !gender}
              onPress={() => setShowWeightClassSheet(true)}
            />
          </Section>
        ) : null}

        <Button
          label="Save changes"
          block
          loading={save.isPending}
          disabled={save.isPending || !hasChanges}
          onPress={handleSave}
          className="mt-10"
        />
      </View>

      <SelectSheet
        visible={showFederationSheet}
        title="Federation"
        items={federations}
        selected={federation}
        keyExtractor={(fed) => fed.id}
        renderLabel={(fed) => ({
          // federations.name is nullable in the schema; code is NOT NULL, so it is
          // the natural fallback.
          title: fed.name ?? fed.code,
          subtitle: fed.code,
        })}
        onCommit={(fed) => {
          if (fed) chooseFederation(fed.id);
          setShowFederationSheet(false);
        }}
        onCancel={() => setShowFederationSheet(false)}
      />

      <SelectSheet
        visible={showDivisionSheet}
        title="Division"
        items={divisions}
        selected={division}
        keyExtractor={(div) => div.id}
        renderLabel={(div) => ({
          // divisions.name is nullable in the schema.
          title: div.name ?? "Unnamed division",
          subtitle: divisionAges(div),
        })}
        onCommit={(div) => {
          if (div) setDivisionId(div.id);
          setShowDivisionSheet(false);
        }}
        onCancel={() => setShowDivisionSheet(false)}
        emptyMessage="No divisions for this federation"
      />

      <SelectSheet
        visible={showWeightClassSheet}
        title="Weight class"
        items={weightClasses}
        selected={weightClass}
        keyExtractor={(wc) => wc.id}
        renderLabel={(wc) => ({ title: `${wc.name} kg` })}
        onCommit={(wc) => {
          if (wc) setWeightClassId(wc.id);
          setShowWeightClassSheet(false);
        }}
        onCancel={() => setShowWeightClassSheet(false)}
        emptyMessage="No weight classes for this federation and gender"
      />
    </Screen>
  );
}
