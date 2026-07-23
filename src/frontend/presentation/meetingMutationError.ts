import { ApiClientError } from "@/frontend/api-client/client";

export function meetingMutationErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "version_conflict") {
      const version = error.currentVersion ? ` The current version is ${error.currentVersion}.` : "";
      return `This meeting changed before the action completed.${version} Refresh the record and try again.`;
    }
    if (error.issues?.length) {
      return `${error.message} ${error.issues.map((issue) => issue.message).join(" ")}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "The meeting action could not be completed.";
}
