export interface AshbyJobReference {
  readonly jobId: string;
  readonly name: string;
}

export function ashbyJobReferences(
  roles: readonly { readonly jobId: string; readonly name: string }[],
): AshbyJobReference[] {
  return roles.flatMap((role) => {
    const jobId = role.jobId.trim();
    if (!jobId) {
      return [];
    }

    return [
      {
        jobId,
        name: role.name.trim() || "Ashby role",
      },
    ];
  });
}
