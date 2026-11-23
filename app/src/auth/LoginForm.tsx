import { useState, type FormEvent } from "react";
import { Center, Paper, Stack, Group, Image, Title, TextInput, PasswordInput, Button, Text, Anchor } from "@mantine/core";
import { login } from "./auth";
import logo from "../assets/icons/gramps-connect-logo.svg";
import { t } from "../i18n/i18n";
import { PROJECT_HOME_URL } from "../config";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Center mih="100vh">
      <Stack gap="sm" align="center">
        <Paper component="form" onSubmit={handleSubmit} withBorder shadow="sm" radius="md" p="xl" w={340}>
          <Stack gap="md">
            <Group gap="xs" justify="center">
              <Image src={logo} alt="" w={32} h={32} />
              <Title order={3}>{t("Gramps Connect")}</Title>
            </Group>
            <TextInput
              label={t("Username")}
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              autoFocus
            />
            <PasswordInput
              label={t("Password")}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            {error && <Text size="sm" c="red">{error}</Text>}
            <Button type="submit" loading={submitting} fullWidth>
              {t("Sign in")}
            </Button>
          </Stack>
        </Paper>
        {/* One link to the project's home page, which leads on to the
            documentation, forum, blog and downloads, so someone stuck at
            this page can still find out what Gramps Connect is and where
            to ask for help. Kept to one small line: this page is every
            deployment's front door, self-hosted family servers included. */}
        <Anchor href={PROJECT_HOME_URL} target="_blank" rel="noopener" size="sm" c="dimmed">
          {t("About Gramps Connect")}
        </Anchor>
      </Stack>
    </Center>
  );
}
