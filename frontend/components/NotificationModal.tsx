// components/NotificationModal.tsx
import { Avatar, Button, Sheet, Text } from "@/components/ui";
import { respondToRequest } from "@/lib/api/notifications";
import { CoachRequest } from "@/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { View } from "react-native";

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
            (request: CoachRequest) => request.id !== variables.requestId,
          ),
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
    // Both Cancel and Done just dismiss: responding to a request is committed
    // immediately by its own button, so there is nothing staged to confirm.
    <Sheet
      visible={visible}
      title="Notifications"
      onCancel={onClose}
      onDone={onClose}
      doneLabel="Done"
    >
      <View className="px-4 py-2">
        {requests?.length > 0 ? (
          requests.map((request, i) => (
            <View
              key={request.id}
              className={`gap-3 py-4 ${
                i > 0
                  ? "border-t border-hairline dark:border-hairline-dark"
                  : ""
              }`}
            >
              <View className="flex-row items-center gap-3">
                <Avatar uri={request.coach_avatar_url} size={40} />
                <Text variant="body" tone="ink" className="flex-1">
                  <Text variant="bodyStrong" tone="ink">
                    @{request.coach_username}
                  </Text>{" "}
                  wants to coach you
                </Text>
              </View>

              <View className="flex-row justify-end gap-2">
                <Button
                  label="Decline"
                  variant="danger"
                  disabled={requestMutation.isPending}
                  onPress={() =>
                    requestMutation.mutate({
                      requestId: request.id,
                      status: "rejected",
                    })
                  }
                />
                <Button
                  label="Accept"
                  disabled={requestMutation.isPending}
                  onPress={() =>
                    requestMutation.mutate({
                      requestId: request.id,
                      status: "accepted",
                    })
                  }
                />
              </View>
            </View>
          ))
        ) : (
          <View className="py-10">
            <Text variant="body" tone="muted" className="text-center">
              No pending requests
            </Text>
          </View>
        )}
      </View>
    </Sheet>
  );
}
