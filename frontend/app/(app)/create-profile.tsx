import {
  Button,
  Chip,
  Screen,
  Section,
  SelectSheet,
  Sheet,
  SheetInput,
  SheetRow,
  Text,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, useColorScheme, View } from "react-native";

interface Federation {
  id: number;
  name: string;
  code: string;
}

interface Division {
  id: number;
  name: string;
  minimum_age: number;
  maximum_age: number;
}

interface WeightClass {
  id: number;
  name: string;
  sort_order: boolean;
}

interface Profile {
  first_name: string;
  last_name: string;
  username: string;
  gender: string;
  date_of_birth: Date;
  federation_id?: number;
  division_id?: number;
  weight_class_id?: number;
  is_athlete: boolean;
  is_coach: boolean;
  biography?: string;
  years_of_experience?: number;
}

/** Ages copy for a division, which may be open-ended at either end. */
function divisionAges(div: Division) {
  if (!div.minimum_age) return `Ages ${div.maximum_age} and under`;
  if (!div.maximum_age) return `Ages ${div.minimum_age} and over`;
  return `Ages ${div.minimum_age} – ${div.maximum_age}`;
}

export default function CreateProfile() {
  // states for actual profile request submission
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState(new Date());

  const [isLoading, setIsLoading] = useState(false);

  // states for modal visibility
  const [showDateModal, setShowDateModal] = useState(false);
  const [showFederationModal, setShowFederationModal] = useState(false);
  const [showDivisionModal, setShowDivisionModal] = useState(false);
  const [showWeightClassModal, setShowWeightClassModal] = useState(false);

  // states for temporary data
  const [tempDate, setTempDate] = useState(new Date());
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedFederation, setSelectedFederation] =
    useState<Federation | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<Division | null>(
    null,
  );
  const [selectedWeightClass, setSelectedWeightClass] =
    useState<WeightClass | null>(null);
  const [biography, setBiography] = useState("");
  const [yearsOfExperience, setYearsOfExperience] = useState("");

  // states for fetched data
  const [federations, setFederations] = useState<Federation[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [weightClasses, setWeightClasses] = useState<WeightClass[]>([]);

  // states for authentication
  const colorScheme = useColorScheme();
  const { session, checkProfileCompletion, fetchProfile } = useAuth();
  const API_URL = process.env.EXPO_PUBLIC_API_URL;

  const ROLES = {
    ATHLETE: "Athlete",
    COACH: "Coach",
  };

  // fetch all federations upon initial load
  useEffect(() => {
    const fetchFederations = async () => {
      const { data, error } = await supabase
        .from("federations")
        .select("id, name, code");
      if (error) {
        console.error("Error fetching federations:", error.message);
        return;
      }
      setFederations(data);
    };
    try {
      setIsLoading(true);
      fetchFederations();
    } catch (error) {
      console.error("Error fetching federations:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // fetch divisions that are apart of selected federation
  useEffect(() => {
    setSelectedDivision(null);
    setDivisions([]);
    const fetchDivisions = async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("id, name, minimum_age, maximum_age")
        .eq("federation_id", selectedFederation!.id);
      if (error) {
        console.error("Error fetching divisions:", error.message);
        return;
      }
      setDivisions(data);
    };
    try {
      setIsLoading(true);
      if (selectedFederation) {
        fetchDivisions();
      }
    } catch (error) {
      console.error("Error fetching divisions:", error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFederation]);

  // fetch weight classes apart of selected federation
  useEffect(() => {
    setSelectedWeightClass(null);
    setWeightClasses([]);
    const fetchWeightClasses = async () => {
      const { data, error } = await supabase
        .from("weight_classes")
        .select("id, name, sort_order")
        .eq("federation_id", selectedFederation!.id)
        .eq("gender", gender);
      if (error) {
        console.error("Error fetching weight classes:", error.message);
        return;
      }
      setWeightClasses(data || []);
    };
    try {
      setIsLoading(true);
      if (selectedFederation && gender) {
        fetchWeightClasses();
      }
    } catch (error) {
      console.error("Error fetching weight classes:", error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFederation, gender]);

  // construct the request to create user profile
  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      if (
        !firstName ||
        !lastName ||
        !gender ||
        !dateOfBirth ||
        !selectedRoles
      ) {
        Alert.alert("Error", "Please fill in all required fields");
        return;
      }

      const payload: Profile = {
        first_name: firstName,
        last_name: lastName,
        username,
        gender,
        date_of_birth: dateOfBirth,
        federation_id: selectedFederation?.id,
        division_id: selectedDivision?.id,
        weight_class_id: selectedWeightClass?.id,
        is_athlete: selectedRoles.includes(ROLES.ATHLETE),
        is_coach: selectedRoles.includes(ROLES.COACH),
        biography: biography,
        years_of_experience: parseInt(yearsOfExperience),
      };

      const response = await fetch(`${API_URL}/users/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        Alert.alert("Error", errorData.error || "Failed to create profile");
        throw new Error(errorData.error);
      }

      console.log("Profile created successfully!");

      if (session?.user?.id) {
        await fetchProfile(session?.user?.id);
        await checkProfileCompletion(session?.user?.id);
      }
      router.replace("/(app)/(tabs)/home");
    } catch (error) {
      console.error("Error creating profile:", error);
      Alert.alert("Error", "Failed to create profile");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const isAthlete = selectedRoles.includes(ROLES.ATHLETE);
  const isCoach = selectedRoles.includes(ROLES.COACH);

  return (
    <Screen scroll centered dismissKeyboard>
      <View className="w-full max-w-md self-center px-6 py-10">
        <Text variant="title" tone="ink">
          Complete your profile
        </Text>
        <Text variant="body" tone="muted" className="mt-2">
          Tell us a bit about yourself.
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
            value={username}
            onChangeText={setUsername}
          />
          <SheetRow
            label="Date of birth"
            value={dateOfBirth.toLocaleDateString()}
            numeric
            chevron
            onPress={() => {
              setTempDate(dateOfBirth);
              setShowDateModal(true);
            }}
          />
        </Section>

        <Section label="Gender" className="mt-8">
          <View className="flex-row gap-2 py-3">
            {["Male", "Female", "Other"].map((option) => (
              <Chip
                key={option}
                label={option}
                selected={gender === option}
                onPress={() => setGender(option)}
                className="flex-1"
              />
            ))}
          </View>
        </Section>

        <Section label="I am a" className="mt-8">
          <View className="flex-row gap-3 py-3">
            {Object.values(ROLES).map((role) => (
              <Chip
                key={role}
                label={role}
                size="lg"
                selected={selectedRoles.includes(role)}
                onPress={() => toggleRole(role)}
                className="flex-1"
              />
            ))}
          </View>
        </Section>

        {isAthlete ? (
          <Section label="Competing" className="mt-8">
            <SheetRow
              label="Federation"
              value={selectedFederation?.name}
              placeholder="Select"
              chevron
              onPress={() => setShowFederationModal(true)}
            />
            <SheetRow
              label="Division"
              value={selectedDivision?.name}
              placeholder={selectedFederation ? "Select" : "Pick a federation"}
              chevron
              disabled={!selectedFederation}
              onPress={() => setShowDivisionModal(true)}
            />
            <SheetRow
              label="Weight class"
              value={
                selectedWeightClass ? `${selectedWeightClass.name} kg` : null
              }
              placeholder={
                !selectedFederation
                  ? "Pick a federation"
                  : !gender
                    ? "Pick a gender"
                    : "Select"
              }
              numeric
              chevron
              disabled={!selectedFederation || !gender}
              onPress={() => setShowWeightClassModal(true)}
            />
          </Section>
        ) : null}

        {isCoach ? (
          <Section label="Coaching" className="mt-8">
            <SheetInput
              label="Biography"
              placeholder="Raw powerlifting coach in the MA area..."
              multiline
              numberOfLines={4}
              maxLength={500}
              value={biography}
              onChangeText={setBiography}
            />
            <SheetInput
              label="Years of experience"
              placeholder="5"
              keyboardType="numeric"
              numeric
              value={yearsOfExperience}
              onChangeText={setYearsOfExperience}
            />
          </Section>
        ) : null}

        <Button
          label="Continue"
          block
          loading={isLoading}
          disabled={isLoading || selectedRoles.length === 0}
          onPress={handleSubmit}
          className="mt-10"
        />
      </View>

      {/* DateTimePicker is a native view and cannot take the palette; it is
          wrapped in the themed sheet so at least its chrome matches. tempDate
          keeps the staged-until-Done semantics the original already had here. */}
      <Sheet
        visible={showDateModal}
        title="Date of birth"
        onCancel={() => setShowDateModal(false)}
        onDone={() => {
          setDateOfBirth(tempDate);
          setShowDateModal(false);
        }}
      >
        <View className="w-full items-center">
          <DateTimePicker
            value={tempDate}
            mode="date"
            display="spinner"
            onChange={(_, selectedDate) => {
              if (selectedDate) {
                setTempDate(selectedDate);
              }
            }}
            maximumDate={new Date()}
            themeVariant={colorScheme === "dark" ? "dark" : "light"}
          />
        </View>
      </Sheet>

      <SelectSheet
        visible={showFederationModal}
        title="Federation"
        items={federations}
        selected={selectedFederation}
        keyExtractor={(fed) => String(fed.id)}
        renderLabel={(fed) => ({ title: fed.name, subtitle: fed.code })}
        onCommit={(fed) => {
          setSelectedFederation(fed);
          setShowFederationModal(false);
        }}
        onCancel={() => setShowFederationModal(false)}
      />

      <SelectSheet
        visible={showDivisionModal}
        title="Division"
        items={divisions}
        selected={selectedDivision}
        keyExtractor={(div) => String(div.id)}
        renderLabel={(div) => ({
          title: div.name,
          subtitle: divisionAges(div),
        })}
        onCommit={(div) => {
          setSelectedDivision(div);
          setShowDivisionModal(false);
        }}
        onCancel={() => setShowDivisionModal(false)}
        emptyMessage="No divisions for this federation"
      />

      <SelectSheet
        visible={showWeightClassModal}
        title="Weight class"
        items={weightClasses}
        selected={selectedWeightClass}
        keyExtractor={(wc) => String(wc.id)}
        renderLabel={(wc) => ({ title: `${wc.name} kg` })}
        onCommit={(wc) => {
          setSelectedWeightClass(wc);
          setShowWeightClassModal(false);
        }}
        onCancel={() => setShowWeightClassModal(false)}
        emptyMessage="No weight classes for this federation and gender"
      />
    </Screen>
  );
}
