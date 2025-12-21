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
} from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import DateTimePicker from "@react-native-community/datetimepicker";

export default function CreateProfile() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const colorScheme = useColorScheme();

  const router = useRouter();
  const { session } = useAuth();
  const API_URL = process.env.EXPO_PUBLIC_API_URL;

  const handleSubmit = async () => {
    // redirect to next page with athlete/coach inputs
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || dateOfBirth;
    setShowDatePicker(Platform.OS === "ios");
    setDateOfBirth(currentDate);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback
        onPress={() => {
          Keyboard.dismiss();
          setShowDatePicker(false);
        }}
        accessible={false}
      >
        <View className="flex-1 bg-background dark:bg-zinc-950">
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
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

              <TouchableOpacity
                className="mt-8 bg-violet-500 h-14 rounded-lg justify-center dark:bg-violet-700"
                onPress={handleSubmit}
                disabled={isLoading}
              >
                <Text className="text-center text-white font-semibold text-base">
                  {isLoading ? "Saving..." : "Save Profile"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
