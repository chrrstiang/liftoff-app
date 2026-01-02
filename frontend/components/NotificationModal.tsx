// components/NotificationModal.tsx
import { View, Text, TouchableOpacity, Modal, Image } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CoachRequest } from "@/types/types";
import { respondToRequest } from "@/lib/api/notifications";

export function NotificationModal({
  visible,
  onClose,
  requests,
  userId,
}: {
  visible: boolean;
  onClose: () => void;
  requests: CoachRequest[];
  userId: string;
}) {
  const queryClient = useQueryClient();

  const requestMutation = useMutation({
    mutationFn: ({
      requestId,
      status,
    }: {
      requestId: string;
      status: "accepted" | "rejected";
    }) => respondToRequest(requestId, status),
    onMutate: async (variables) => {
      queryClient.cancelQueries({ queryKey: ["requests", userId] });

      const prevRequests = queryClient.getQueryData<CoachRequest[]>([
        "requests",
        userId,
      ]);

      if (prevRequests) {
        queryClient.setQueryData(
          ["requests", userId],
          prevRequests.filter(
            (request: CoachRequest) => request.id !== variables.requestId
          )
        );
      }

      return { prevRequests };
    },
    onError: (error, variables, context) => {
      if (context?.prevRequests) {
        queryClient.setQueryData(["requests", userId], context.prevRequests);
      }

      console.error("Error accepting request", error);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["requests", userId] });

      if (variables.status === "accepted") {
        queryClient.invalidateQueries({ queryKey: ["athletes", userId] });
      }
    },
  });

  if (!visible) return null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-white dark:bg-zinc-800 rounded-t-3xl p-6 max-h-3/4">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-xl font-bold text-foreground dark:text-white">
              Notifications
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text className="text-blue-500 text-lg">Close</Text>
            </TouchableOpacity>
          </View>

          <View className="space-y-4">
            {requests?.length > 0 ? (
              requests.map((request) => (
                <View
                  key={request.id}
                  className="bg-gray-100 dark:bg-zinc-700 p-4 rounded-lg"
                >
                  <View className="flex-row items-center space-x-3">
                    {request.coach_avatar_url ? (
                      <Image
                        source={{ uri: request.coach_avatar_url }}
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <Image
                        source={require("@/assets/images/avatar-default.png")}
                        className="w-10 h-10 rounded-full"
                      />
                    )}
                    <Text className="flex-1 text-foreground dark:text-white">
                      <Text className="font-semibold">
                        @{request.coach_username}
                      </Text>{" "}
                      wants to coach you
                    </Text>
                  </View>
                  <View className="flex-row justify-end space-x-2 mt-3">
                    <TouchableOpacity
                      onPress={() =>
                        requestMutation.mutate({
                          requestId: request.id,
                          status: "rejected",
                        })
                      }
                      disabled={requestMutation.isPending}
                      className="px-4 py-2 border border-red-500 rounded-lg"
                    >
                      <Text className="text-red-500">Decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        requestMutation.mutate({
                          requestId: request.id,
                          status: "accepted",
                        })
                      }
                      disabled={requestMutation.isPending}
                      className="px-4 py-2 bg-green-600 dark:bg-green-800 rounded-lg"
                    >
                      <Text className="text-white">Accept</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <Text className="text-center text-foreground/50 dark:text-gray-400 py-4">
                No pending requests
              </Text>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
