import { useState, type FormEvent } from "react";
import { Center, Paper, Stack, Group, Image, Title, TextInput, PasswordInput, Button, Text } from "@mantine/core";
import { login } from "./auth";
import logo from "../assets/icons/gramps-logo.svg";

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
      <Paper component="form" onSubmit={handleSubmit} withBorder shadow="sm" radius="md" p="xl" w={340}>
        <Stack gap="md">
          <Group gap="xs" justify="center">
            <Image src={logo} alt="" w={32} h={32} />
            <Title order={3}>Gramps Connect</Title>
          </Group>
          <TextInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            autoFocus
          />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          {error && <Text size="sm" c="red">{error}</Text>}
          <Button type="submit" loading={submitting} fullWidth>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
