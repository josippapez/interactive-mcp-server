export type PermissionAction = 'once' | 'always' | 'reject';

export type PermissionActionSpec = {
  action: PermissionAction;
  label: string;
  variant: 'ghost' | 'outline' | 'default';
};

export function getPermissionActions(): PermissionActionSpec[] {
  return [
    { action: 'reject', label: 'Deny', variant: 'ghost' },
    { action: 'always', label: 'Allow Always', variant: 'outline' },
    { action: 'once', label: 'Allow Once', variant: 'default' },
  ];
}
