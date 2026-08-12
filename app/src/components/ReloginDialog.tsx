import { useState, type FormEvent } from "react";
import { Button, Group, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { getCurrentUsername, login } from "../auth/auth";

interface ReloginDialogProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** gramps-web-api requires a *fresh* JWT for a handful of irreversible
 * actions (fresh_jwt_required, e.g. deleting every object in the tree) --
 * one minted directly by login(), not the silent refresh getToken() does
 * well before expiry (see auth.ts's isTokenFresh()). This re-collects the
 * password and calls login() again to mint a fresh token, then hands
 * control back to the caller via onSuccess to retry whatever it was doing. */
export function ReloginDialog({ opened, onClose, onSuccess }: ReloginDialogProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const username = getCurrentUsername();

  function handleClose() {
    setPassword("");
    setError("");
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(username ?? "", password);
      setPassword("");
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Confirm your password" size="sm">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Text size="sm">This action requires you to sign in again to continue.</Text>
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoFocus
          />
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button type="button" variant="default" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!password}>
              Continue
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
