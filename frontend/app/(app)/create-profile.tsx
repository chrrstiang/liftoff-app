import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
  ScrollView,
  Modal,
  useColorScheme,
  StyleSheet,
} from "react-native";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { Check } from "lucide-react-native";

interface SelectionModalProps<T> {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: T[];
  selectedItem: T | null;
  onSelect: (item: T) => void;
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  keyExtractor: (item: T) => string | number;
}

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
    null
  );
  const [selectedWeightClass, setSelectedWeightClass] =
    useState<WeightClass | null>(null);
  const [coachLevel, setCoachLevel] = useState("");

  // states for fetched data
  const [federations, setFederations] = useState<Federation[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [weightClasses, setWeightClasses] = useState<WeightClass[]>([]);

  // states for authentication
  const colorScheme = useColorScheme();
  const { session } = useAuth();
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
      console.log("Fetched federations, ", data);
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
    const fetchDivisions = async () => {
      const { data, error } = await supabase
        .from("divisions")
        .select("id, name, minimum_age, maximum_age")
        .eq("federation_id", selectedFederation!.id);
      console.log("Fetched divisions, ", data);
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
    const fetchWeightClasses = async () => {
      const { data, error } = await supabase
        .from("weight_classes")
        .select("id, name, sort_order")
        .eq("federation_id", selectedFederation!.id)
        .eq("gender", gender);
      console.log("Fetched weight classes, ", data);
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
    if (!firstName || !lastName || !gender || !dateOfBirth) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }

    const response = await fetch(`${API_URL}/athlete/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        gender,
        date_of_birth: dateOfBirth.toISOString(),
        federation_id: selectedFederation?.id,
        division_id: selectedDivision?.id,
        weight_class_id: selectedWeightClass?.id,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      Alert.alert("Error", errorData.error || "Failed to create profile");
      return;
    }

    // TODO: Handle successful creation
    console.log("Profile created successfully");
  };

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback
        onPress={() => {
          Keyboard.dismiss();
        }}
        accessible={false}
      >
        <View className="flex-1 bg-background dark:bg-zinc-950">
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <View className="p-6 w-full max-w-md mx-auto">
              <Text className="text-2xl font-bold text-center text-foreground dark:text-white mb-2">
                Complete Your Profile
              </Text>
              <Text className="text-center text-muted-foreground dark:text-gray-300 mb-8">
                Tell us a bit about yourself
              </Text>

              <View className="space-y-4 w-full">
                {/* First Name */}
                <View>
                  <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                    First Name
                  </Text>
                  <TextInput
                    className="h-12 border border-gray-300 rounded-lg px-4 dark:bg-zinc-900 dark:border-zinc-800 dark:text-white"
                    placeholder="John"
                    value={firstName}
                    onChangeText={setFirstName}
                  />
                </View>

                {/* Last Name */}
                <View>
                  <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                    Last Name
                  </Text>
                  <TextInput
                    className="h-12 border border-gray-300 rounded-lg px-4 dark:bg-zinc-900 dark:border-zinc-800 dark:text-white"
                    placeholder="Doe"
                    value={lastName}
                    onChangeText={setLastName}
                  />
                </View>

                {/* Username */}
                <View>
                  <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                    Username
                  </Text>
                  <TextInput
                    className="h-12 border border-gray-300 rounded-lg px-4 dark:bg-zinc-900 dark:border-zinc-800 dark:text-white"
                    placeholder="johndoe"
                    autoCapitalize="none"
                    value={username}
                    onChangeText={setUsername}
                  />
                </View>

                {/* Gender */}
                <View>
                  <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                    Gender
                  </Text>
                  <View className="flex-row space-x-2">
                    {["Male", "Female", "Other"].map((option) => (
                      <TouchableOpacity
                        key={option}
                        className={`flex-1 h-12 items-center justify-center rounded-lg border ${
                          gender === option
                            ? "bg-violet-500 border-violet-500"
                            : "border-gray-300 dark:border-zinc-700"
                        }`}
                        onPress={() => setGender(option)}
                      >
                        <Text
                          className={`font-medium ${
                            gender === option
                              ? "text-white"
                              : "text-foreground dark:text-gray-200"
                          }`}
                        >
                          {option}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Date of Birth */}
                <View>
                  <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                    Date of Birth
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setTempDate(dateOfBirth);
                      setShowDateModal(true);
                    }}
                    className="h-12 border border-gray-300 rounded-lg px-4 justify-center dark:border-zinc-700"
                  >
                    <Text className="dark:text-white">
                      {dateOfBirth.toLocaleDateString()}
                    </Text>
                  </TouchableOpacity>
                  <Modal
                    visible={showDateModal}
                    transparent={true}
                    animationType="slide"
                    onRequestClose={() => setShowDateModal(false)}
                  >
                    <View className="flex-1 justify-end bg-black/50">
                      <View className="bg-white dark:bg-zinc-800 rounded-t-2xl p-6">
                        <View className="flex-row justify-between items-center mb-4">
                          <TouchableOpacity
                            onPress={() => setShowDateModal(false)}
                          >
                            <Text className="text-blue-500 text-lg">
                              Cancel
                            </Text>
                          </TouchableOpacity>
                          <Text className="text-lg font-semibold dark:text-white">
                            Select Date
                          </Text>
                          <TouchableOpacity
                            onPress={() => {
                              setDateOfBirth(tempDate);
                              setShowDateModal(false);
                            }}
                          >
                            <Text className="text-blue-500 text-lg font-semibold">
                              Done
                            </Text>
                          </TouchableOpacity>
                        </View>
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
                            themeVariant={
                              colorScheme === "dark" ? "dark" : "light"
                            }
                          />
                        </View>
                      </View>
                    </View>
                  </Modal>
                </View>
              </View>

              <View className="space-y-8">
                {/* Role Selection */}
                <View>
                  <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-3">
                    I am a (select all that apply)
                  </Text>
                  <View className="flex-row space-x-3">
                    {Object.values(ROLES).map((role) => (
                      <TouchableOpacity
                        key={role}
                        onPress={() => toggleRole(role)}
                        className={`flex-1 h-14 items-center justify-center rounded-lg border ${
                          selectedRoles.includes(role)
                            ? "bg-violet-500 border-violet-500"
                            : "border-gray-300 dark:border-zinc-700"
                        }`}
                      >
                        <Text
                          className={`font-medium ${
                            selectedRoles.includes(role)
                              ? "text-white"
                              : "text-foreground dark:text-gray-200"
                          }`}
                        >
                          {role}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                {/* Athlete Specific Fields */}
                {selectedRoles.includes(ROLES.ATHLETE) && (
                  <View className="my-2">
                    <Text className="text-lg font-semibold dark:text-white">
                      Athlete Details
                    </Text>
                    <View className="my-2">
                      <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                        Federation
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedFederation(selectedFederation);
                          setShowFederationModal(true);
                        }}
                        className="h-12 border border-gray-300 rounded-lg px-4 justify-center dark:border-zinc-700"
                      >
                        <Text
                          className={`dark:text-white ${selectedFederation ? "text-foreground dark:text-gray-200" : "text-muted-foreground dark:text-gray-300"}`}
                        >
                          {selectedFederation?.name || "Select Federation..."}
                        </Text>
                      </TouchableOpacity>
                      <SelectionModal
                        visible={showFederationModal}
                        onClose={() => setShowFederationModal(false)}
                        title="Select Federation"
                        items={federations}
                        selectedItem={selectedFederation}
                        onSelect={(fed) => setSelectedFederation(fed)}
                        keyExtractor={(fed) => fed.id}
                        renderItem={(fed, isSelected) => (
                          <>
                            <View className="flex-row justify-between items-center">
                              <Text
                                className={`text-base ${
                                  isSelected
                                    ? "text-violet-600 dark:text-violet-400 font-medium"
                                    : "text-gray-800 dark:text-gray-200"
                                }`}
                              >
                                {fed.name}
                              </Text>
                              {isSelected && (
                                <Check size={18} color="#9D79BC" />
                              )}
                            </View>
                            <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {fed.code}
                            </Text>
                          </>
                        )}
                      />
                      <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                        Division
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedDivision(selectedDivision);
                          setShowDivisionModal(true);
                        }}
                        className="h-12 border border-gray-300 rounded-lg px-4 justify-center dark:border-zinc-700"
                      >
                        <Text
                          className={`dark:text-white ${selectedDivision ? "text-foreground dark:text-gray-200" : "text-muted-foreground dark:text-gray-300"}`}
                        >
                          {selectedDivision?.name || "Select Division..."}
                        </Text>
                      </TouchableOpacity>
                      <SelectionModal
                        visible={showDivisionModal}
                        onClose={() => setShowDivisionModal(false)}
                        title="Select Division"
                        items={divisions}
                        selectedItem={selectedDivision}
                        onSelect={(div) => setSelectedDivision(div)}
                        keyExtractor={(div) => div.id}
                        renderItem={(div, isSelected) => (
                          <>
                            <View className="flex-row justify-between items-center">
                              <Text
                                className={`text-base ${
                                  isSelected
                                    ? "text-violet-600 dark:text-violet-400 font-medium"
                                    : "text-gray-800 dark:text-gray-200"
                                }`}
                              >
                                {div.name}
                              </Text>
                              {isSelected && (
                                <Check size={18} color="#9D79BC" />
                              )}
                            </View>
                            <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              Ages{" "}
                              {!div.minimum_age
                                ? `${div.maximum_age} and under`
                                : !div.maximum_age
                                  ? `${div.minimum_age} and over`
                                  : `${div.minimum_age} - ${div.maximum_age}`}
                            </Text>
                          </>
                        )}
                      />
                      <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                        Weight Class (kg)
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedWeightClass(selectedWeightClass);
                          setShowWeightClassModal(true);
                        }}
                        className="h-12 border border-gray-300 rounded-lg px-4 justify-center dark:border-zinc-700"
                      >
                        <Text
                          className={`dark:text-white ${selectedWeightClass ? "text-foreground dark:text-gray-200" : "text-muted-foreground dark:text-gray-300"}`}
                        >
                          {selectedWeightClass?.name ||
                            "Select Weight Class..."}
                        </Text>
                      </TouchableOpacity>
                      <SelectionModal
                        visible={showWeightClassModal}
                        onClose={() => setShowWeightClassModal(false)}
                        title="Select Weight Class"
                        items={weightClasses}
                        selectedItem={selectedWeightClass}
                        onSelect={(wc) => setSelectedWeightClass(wc)}
                        keyExtractor={(wc) => wc.id}
                        renderItem={(wc, isSelected) => (
                          <View className="flex-row justify-between items-center">
                            <Text
                              className={`text-base ${
                                isSelected
                                  ? "text-violet-600 dark:text-violet-400 font-medium"
                                  : "text-gray-800 dark:text-gray-200"
                              }`}
                            >
                              {wc.name} kg
                            </Text>
                            {isSelected && <Check size={18} color="#9D79BC" />}
                          </View>
                        )}
                      />
                    </View>
                  </View>
                )}
                {/* Coach Specific Fields */}
                {selectedRoles.includes(ROLES.COACH) && (
                  <View className="space-y-4">
                    <Text className="text-lg font-semibold dark:text-white">
                      Coach Details
                    </Text>
                    <View>
                      <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                        Certification Level
                      </Text>
                      <View className="flex-row space-x-2">
                        {["Level 1", "Level 2", "Level 3", "Level 4"].map(
                          (level) => (
                            <TouchableOpacity
                              key={level}
                              onPress={() => setCoachLevel(level)}
                              className={`flex-1 h-12 items-center justify-center rounded-lg border ${
                                coachLevel === level
                                  ? "bg-violet-500 border-violet-500"
                                  : "border-gray-300 dark:border-zinc-700"
                              }`}
                            >
                              <Text
                                className={`text-sm ${
                                  coachLevel === level
                                    ? "text-white"
                                    : "text-foreground dark:text-gray-200"
                                }`}
                              >
                                {level}
                              </Text>
                            </TouchableOpacity>
                          )
                        )}
                      </View>
                    </View>
                    <View>
                      <Text className="text-sm text-muted-foreground dark:text-gray-300 mb-1">
                        Years of Experience
                      </Text>
                      <TextInput
                        className="h-12 border border-gray-300 rounded-lg px-4 dark:bg-zinc-900 dark:border-zinc-800 dark:text-white"
                        placeholder="e.g., 5"
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                )}
                {/* Save Button */}
                <TouchableOpacity
                  className="bg-violet-500 h-14 rounded-lg justify-center dark:bg-violet-700"
                  onPress={handleSubmit}
                  disabled={isLoading || selectedRoles.length === 0}
                >
                  <Text className="text-center text-white font-semibold text-base">
                    {isLoading ? "Saving..." : "Continue"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
  },
});

function SelectionModal<T>({
  visible,
  onClose,
  title,
  items,
  selectedItem,
  onSelect,
  renderItem,
  keyExtractor,
}: SelectionModalProps<T>) {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-white dark:bg-zinc-800 rounded-t-2xl p-6">
          <View className="flex-row justify-between items-center mb-4">
            <TouchableOpacity onPress={onClose}>
              <Text className="text-blue-500 text-lg">Cancel</Text>
            </TouchableOpacity>
            <Text className="text-lg font-semibold dark:text-white">
              {title}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text className="text-blue-500 text-lg font-semibold">Done</Text>
            </TouchableOpacity>
          </View>
          <View className="w-full mt-2 border-t border-gray-200 dark:border-zinc-700">
            <ScrollView
              className="max-h-64"
              showsVerticalScrollIndicator={true}
            >
              {items.map((item) => (
                <TouchableOpacity
                  key={keyExtractor(item)}
                  className={`py-3 px-4 border-b border-gray-100 dark:border-zinc-700 ${
                    selectedItem &&
                    keyExtractor(selectedItem) === keyExtractor(item)
                      ? "bg-blue-50 dark:bg-violet-900/20"
                      : "bg-white dark:bg-zinc-800"
                  }`}
                  onPress={() => onSelect(item)}
                >
                  {renderItem(
                    item,
                    selectedItem
                      ? keyExtractor(selectedItem) === keyExtractor(item)
                      : false
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}
