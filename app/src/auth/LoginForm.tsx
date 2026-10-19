import { useState, type FormEvent } from "react";
import { Center, Paper, Stack, Group, Image, Title, TextInput, PasswordInput, Button, Text, Anchor } from "@mantine/core";
import { login } from "./auth";
import logo from "../assets/icons/gramps-connect-logo.svg";
import { t } from "../i18n/i18n";
import { DISCUSSION_FORUM_URL } from "../config";
import { AboutDialog } from "../components/AboutDialog";
import { DocumentationDialog } from "../components/DocumentationDialog";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [documentationOpened, setDocumentationOpened] = useState(false);
  const [aboutOpened, setAboutOpened] = useState(false);

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
        {/* The same three Help-menu entries that need no sign-in -- the
            documentation and forum are both fetched/opened straight from
            public sites, and About's prose is the same for every reader --
            so someone stuck at this page can still find out what it is and
            ask for help. Deliberately plain: this page is every deployment's
            front door, self-hosted family servers included, not a project
            homepage. */}
        <Group gap="xs" justify="center">
          <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => setDocumentationOpened(true)}>
            {t("Documentation")}
          </Anchor>
          <Text size="sm" c="dimmed">·</Text>
          <Anchor href={DISCUSSION_FORUM_URL} target="_blank" rel="noopener" size="sm" c="dimmed">
            {t("Discussion Forum")}
          </Anchor>
          <Text size="sm" c="dimmed">·</Text>
          <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => setAboutOpened(true)}>
            {t("About")}
          </Anchor>
        </Group>
      </Stack>
      <DocumentationDialog opened={documentationOpened} onClose={() => setDocumentationOpened(false)} />
      <AboutDialog opened={aboutOpened} onClose={() => setAboutOpened(false)} />
    </Center>
  );
}
