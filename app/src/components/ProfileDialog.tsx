import { useEffect, useState } from "react";
import { Alert, Button, Divider, Group, Modal, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken, hasPermissions, setCurrentUsername } from "../auth/auth";
import { fetchOwnUser, updateOwnUser, changeOwnPassword } from "../store/usersApi";
import { t } from "../i18n/i18n";

interface ProfileDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Self-service account editing: username/full name/email (one PUT
 * /api/users/-/ sending only the fields that actually changed, per
 * usersApi.ts's own doc comment) plus a separate password-change section
 * (its own endpoint, its own re-proof of the current password). Every role
 * from ROLE_GUEST up carries EditOwnUser, so this is reachable from
 * UserMenu.tsx regardless of role -- unlike every other edit dialog in the
 * app, there's no case where the fields render but are actually
 * unreachable; hasPermissions() is still checked so this degrades the same
 * way the rest of the app would if that ever changed. */
export function ProfileDialog({ opened, onClose }: ProfileDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setLoadError(null);
    setProfileError(null);
    setPasswordError(null);
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const user = await fetchOwnUser(token);
        setUsername(user.name ?? "");
        setFullName(user.full_name ?? "");
        setEmail(user.email ?? "");
      } catch (err: any) {
        setLoadError(err.message ?? String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [opened]);

  const canEdit = hasPermissions("EditOwnUser");

  async function handleSaveProfile() {
    setProfileError(null);
    setSavingProfile(true);
    try {
      const token = await getToken();
      await updateOwnUser(token, {
        name_new: username,
        full_name: fullName,
        email,
      });
      setCurrentUsername(username);
      notifications.show({ color: "green", message: t("Profile updated.") });
    } catch (err: any) {
      setProfileError(err.message ?? String(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError(t("New passwords do not match."));
      return;
    }
    setChangingPassword(true);
    try {
      const token = await getToken();
      await changeOwnPassword(token, oldPassword, newPassword);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notifications.show({ color: "green", message: t("Password changed.") });
    } catch (err: any) {
      setPasswordError(err.message ?? String(err));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Profile")} size="sm">
      {loadError && <Alert color="red" mb="sm">{loadError}</Alert>}
      <Stack gap="sm">
        <TextInput
          label={t("Username")}
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          disabled={!canEdit || loading}
        />
        <TextInput
          label={t("Full name")}
          value={fullName}
          onChange={(e) => setFullName(e.currentTarget.value)}
          disabled={!canEdit || loading}
        />
        <TextInput
          label={t("Email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          disabled={!canEdit || loading}
        />
        {profileError && <Alert color="red">{profileError}</Alert>}
        <Group justify="flex-end">
          <Button
            onClick={handleSaveProfile}
            loading={savingProfile}
            disabled={!canEdit || loading || !username}
          >
            {t("Save")}
          </Button>
        </Group>

        <Divider label={t("Change password")} labelPosition="center" mt="sm" />
        {!canEdit && <Text size="sm" c="dimmed">{t("You don't have permission to change your password.")}</Text>}
        <PasswordInput
          label={t("Current password")}
          value={oldPassword}
          onChange={(e) => setOldPassword(e.currentTarget.value)}
          disabled={!canEdit || loading}
        />
        <PasswordInput
          label={t("New password")}
          value={newPassword}
          onChange={(e) => setNewPassword(e.currentTarget.value)}
          disabled={!canEdit || loading}
        />
        <PasswordInput
          label={t("Confirm new password")}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.currentTarget.value)}
          disabled={!canEdit || loading}
        />
        {passwordError && <Alert color="red">{passwordError}</Alert>}
        <Group justify="flex-end">
          <Button
            onClick={handleChangePassword}
            loading={changingPassword}
            disabled={!canEdit || loading || !oldPassword || !newPassword}
          >
            {t("Change password")}
          </Button>
        </Group>

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>{t("Close")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
