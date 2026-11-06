import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  access,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rootPluginId } from "@zhin.js/plugin-runtime";
import {
  personalSessionIdentity,
  personalSessionOwnerId,
} from "@zhin.js/agent/personal-session";
import {
  persistentProfileSelection,
  createProfileReference,
  resolveProviderProfile,
} from "@zhin.js/ai/provider";
import { openHeadlessInferenceHost } from "@zhin.js/agent/runtime";
import { InferenceSessionRepository } from "@zhin.js/agent/runtime";
import {
  previewSessionBindings,
  applySessionBindings,
  readSessionBindingsPreview,
} from "../../../src/plugin-runtime/inference/migration-session-bindings.js";
import * as journals from "@zhin.js/agent/runtime";
import { hostModelOwnerId } from "@zhin.js/plugin-runtime";

async function fixture() {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "manual-session-binding-"))
    ),
    filename = join(root, ".zhin", "state.sqlite");
  const identity = personalSessionIdentity({
    rootId: root,
    platform: "icqq",
    endpoint: "account-instance",
    subjectId: "alice",
    conversation: {
      endpoint: { adapter: "icqq", id: "root/plugin/account~one" },
      kind: "channel",
      id: "child",
      parent: { kind: "group", id: "parent" },
      threadId: "thread",
    },
  });
  const ownerId = personalSessionOwnerId(identity.owner),
    hostOwnerId = hostModelOwnerId(root);
  const document = {
    configVersion: 2,
    database: { dialect: "sqlite", filename },
    ai: { enabled: true, personalPrincipals: { alice: [identity.owner] } },
  };
  const file = join(root, "zhin.config.json");
  await writeFile(file, JSON.stringify(document));
  const opened = await openHeadlessInferenceHost({
    projectRoot: root,
    database: { dialect: "sqlite", filename },
    resolveSource: () => {
      throw new Error("No credentials permitted");
    },
    officialDrivers: false,
  });
  const resource = { rootId: root, revision: 1, ownerId },
    service = {
      ...resource,
      ownerId: hostOwnerId,
      id: "service",
      driver: {
        id: "third-party-deliberately-unavailable",
        owner: "root/external-plugin",
        contractVersion: "1",
      },
      options: {},
      models: {
        native: {
          id: "native",
          protocol: "external-custom-protocol",
          kinds: ["language"] as const,
        },
        changed: {
          id: "changed",
          protocol: "external-custom-protocol",
          kinds: ["language"] as const,
        },
      },
    };
  const account = {
    ...resource,
    id: "account",
    serviceId: "service",
    incarnation: "original-incarnation",
    authentication: { method: "api-key" as const },
  };
  const profile = {
    ...resource,
    id: "profile",
    accountId: "account",
    model: "native",
    parameters: {},
  };
  const graph = {
    rootId: root,
    revision: 1,
    services: { service },
    accounts: { account },
    profiles: { profile },
    purposes: { defaults: {} },
  };
  let sourceRevision: string;
  try {
    await opened.host.repository.commit({
      rootId: root,
      expectedRevision: 0,
      mutationId: "setup",
      fingerprint: "setup",
      result: null,
      graph,
    });
    const state = opened.database.state!;
    await state.compareExchange(
      rootPluginId(),
      { kind: "plugin" },
      identity.key,
      undefined,
      JSON.parse(
        JSON.stringify({
          version: 1,
          kind: "personal-session",
          state: {
            identity,
            revision: 1,
            selection: { kind: "preset", presetId: "old-display-alias" },
          },
        })
      ),
      null
    );
    sourceRevision = (await state.read(
      rootPluginId(),
      { kind: "plugin" },
      identity.key
    ))!.revision;
  } finally {
    await opened.close();
  }
  const selection = {
    kind: "profile" as const,
    profile: persistentProfileSelection(
      createProfileReference({
        kind: "language",
        binding: {
          graphRevision: 1,
          service,
          account,
          profile,
          model: service.models.native,
        },
      })
    ),
  };
  const mapping = {
    version: 1,
    sessions: { [identity.key]: { sourceRevision, selection } },
  };
  const open = () =>
    openHeadlessInferenceHost({
      projectRoot: root,
      database: { dialect: "sqlite", filename },
      resolveSource: () => {
        throw new Error("No credentials permitted");
      },
      officialDrivers: false,
    });
  return {
    root,
    filename,
    identity,
    ownerId,
    document,
    file,
    graph,
    mapping,
    open,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

it("previews selected SQLite state read-only, then binds an unavailable third-party Profile via the real CLI", async () => {
  const f = await fixture();
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    const bytes = await readFile(f.filename),
      original = await readFile(f.file);
    const preview = await previewSessionBindings({
      root: f.root,
      mapping: f.mapping,
    });
    expect(preview.mode).toBe("sessions");
    expect(preview.sessions).toHaveLength(1);
    expect(await readFile(f.filename)).toEqual(bytes);
    expect(await readFile(f.file)).toEqual(original);
    await expect(
      access(join(f.root, ".zhin", "inference"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(fetch).not.toHaveBeenCalled();
    const mappingFile = join(f.root, "mapping.json"),
      output = join(f.root, "session-preview.json");
    await writeFile(mappingFile, JSON.stringify(f.mapping));
    const repo = resolve(import.meta.dirname, "../../../../.."),
      run = promisify(execFile);
    const args = [
      "--conditions=development",
      "--import",
      join(repo, "node_modules/tsx/dist/esm/index.mjs"),
      join(repo, "basic/cli/src/cli.ts"),
      "migrate",
      "inference",
    ];
    const options = {
      cwd: f.root,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: f.root,
        GROQ_API_KEY: "",
        NODE_OPTIONS: "",
      },
      maxBuffer: 1024 * 1024,
    };
    await run(
      process.execPath,
      [
        ...args,
        "--sessions-only",
        "--mapping",
        mappingFile,
        "--output",
        output,
      ],
      options
    );
    expect((await readSessionBindingsPreview(output)).sessions).toEqual(
      preview.sessions
    );
    const result = await run(
      process.execPath,
      [...args, "--apply", output, "--maintenance", "--backup-confirmed"],
      options
    );
    expect(result.stdout).toMatch(/"phase":\s*"committed"/u);
    expect(result.stdout).toMatch(/"migratedSessions":\s*1/u);
    const opened = await f.open();
    try {
      const selected = await new InferenceSessionRepository(
        () => opened.database.state
      ).read(f.identity);
      expect(selected?.selection).toEqual(
        f.mapping.sessions[f.identity.key].selection
      );
      expect(selected?.identity.address.conversation).toMatchObject({
        parent: { kind: "group", id: "parent" },
        threadId: "thread",
      });
      const graph = (await opened.host.repository.readGraph({
        rootId: f.root,
      }))!;
      const binding = resolveProviderProfile({
        graph,
        kind: "language",
        purpose: "chat",
        context: {
          rootId: f.root,
          hostOwnerId: opened.host.hostOwnerId,
          ownerId: f.ownerId,
          operationId: "next-turn",
          sessionKey: f.identity.key,
          sessionChat: f.mapping.sessions[f.identity.key].selection.profile,
        },
      });
      expect(binding.model.id).toBe("native");
    } finally {
      await opened.close();
    }
    expect(await readFile(f.file)).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
    await f.close();
  }
});

it("rejects a missing database without creating a database, key or migration directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-preview-missing-"));
  try {
    await writeFile(
      join(root, "zhin.config.json"),
      JSON.stringify({ configVersion: 2, ai: { personalPrincipals: {} } })
    );
    await expect(
      previewSessionBindings({
        root,
        mapping: {
          version: 1,
          sessions: {
            arbitrary: {
              sourceRevision: "one",
              selection: { kind: "inherit" },
            },
          },
        },
      })
    ).rejects.toThrow("existing Session database");
    await expect(access(join(root, ".zhin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "owner",
  "source-revision",
  "incarnation",
  "incomplete-profile",
  "session-identity",
] as const)("rejects %s before any state write", async (problem) => {
  const f = await fixture();
  try {
    const before = await readFile(f.filename),
      mapping = structuredClone(f.mapping);
    if (problem === "owner") {
      await writeFile(
        f.file,
        JSON.stringify({
          ...f.document,
          ai: { enabled: true, personalPrincipals: {} },
        })
      );
    }
    if (problem === "source-revision")
      mapping.sessions[f.identity.key].sourceRevision = "stale";
    if (problem === "incarnation")
      mapping.sessions[f.identity.key].selection.profile = {
        ...mapping.sessions[f.identity.key].selection.profile,
        accountIncarnation: "other",
      };
    if (problem === "incomplete-profile")
      delete (
        mapping.sessions[f.identity.key].selection.profile as Partial<
          (typeof mapping.sessions)[string]["selection"]["profile"]
        >
      ).accountId;
    if (problem === "session-identity") {
      mapping.sessions.arbitrary = mapping.sessions[f.identity.key];
      delete mapping.sessions[f.identity.key];
    }
    await expect(
      previewSessionBindings({ root: f.root, mapping })
    ).rejects.toThrow();
    expect(await readFile(f.filename)).toEqual(before);
  } finally {
    await f.close();
  }
});

it("revalidates current owner/incarnation before applying but allows the same Profile to change native model", async () => {
  const f = await fixture();
  try {
    const preview = await previewSessionBindings({
      root: f.root,
      mapping: f.mapping,
    });
    const opened = await f.open();
    try {
      await opened.host.repository.commit({
        rootId: f.root,
        expectedRevision: 1,
        mutationId: "model-update",
        fingerprint: "model-update",
        result: null,
        graph: {
          ...f.graph,
          revision: 2,
          profiles: {
            profile: {
              ...f.graph.profiles.profile,
              revision: 2,
              model: "changed",
              parameters: { temperature: 0.4 },
            },
          },
        },
      });
    } finally {
      await opened.close();
    }
    expect(
      await applySessionBindings({
        preview,
        maintenance: true,
        backupConfirmed: true,
      })
    ).toMatchObject({ phase: "committed" });
    const next = await f.open();
    try {
      const state = await new InferenceSessionRepository(
          () => next.database.state
        ).read(f.identity),
        graph = (await next.host.repository.readGraph({ rootId: f.root }))!;
      expect(state?.selection).toEqual(
        f.mapping.sessions[f.identity.key].selection
      );
      expect(
        resolveProviderProfile({
          graph,
          kind: "language",
          context: {
            rootId: f.root,
            ownerId: f.ownerId,
            hostOwnerId: next.host.hostOwnerId,
            operationId: "next",
            sessionKey: f.identity.key,
            sessionChat: f.mapping.sessions[f.identity.key].selection.profile,
          },
          purpose: "chat",
        }).model.id
      ).toBe("changed");
    } finally {
      await next.close();
    }
  } finally {
    await f.close();
  }
});

it("recovers an acknowledgment loss by exact target readback without replaying the real SQLite CAS", async () => {
  const f = await fixture(),
    original = journals.applyMigrationSessionJournal;
  let writes = 0;
  const fault = vi
    .spyOn(journals, "applyMigrationSessionJournal")
    .mockImplementationOnce(async (input) => {
      const compareExchange = input.state.compareExchange.bind(input.state);
      return original({
        ...input,
        state: {
          ...input.state,
          compareExchange: async (...args) => {
            writes++;
            await compareExchange(...args);
            throw new Error("synthetic acknowledgment loss");
          },
        },
      });
    });
  try {
    const preview = await previewSessionBindings({
        root: f.root,
        mapping: f.mapping,
      }),
      options = { preview, maintenance: true, backupConfirmed: true };
    expect(await applySessionBindings(options)).toMatchObject({
      phase: "unknown",
      migratedSessions: 0,
    });
    fault.mockRestore();
    const noReplay = vi
      .spyOn(journals, "applyMigrationSessionJournal")
      .mockImplementation(async (input) =>
        original({
          ...input,
          state: {
            ...input.state,
            compareExchange: async () => {
              throw new Error("CAS must not replay");
            },
          },
        })
      );
    try {
      expect(await applySessionBindings(options)).toMatchObject({
        phase: "committed",
        migratedSessions: 1,
      });
    } finally {
      noReplay.mockRestore();
    }
    expect(writes).toBe(1);
    expect(await applySessionBindings(options)).toMatchObject({
      phase: "committed",
      migratedSessions: 1,
    });
  } finally {
    fault.mockRestore();
    await f.close();
  }
});

it("requires maintenance and backup confirmation, and supports only explicit inherit", async () => {
  const f = await fixture();
  try {
    const mapping = {
      version: 1,
      sessions: {
        [f.identity.key]: {
          sourceRevision: f.mapping.sessions[f.identity.key].sourceRevision,
          selection: { kind: "inherit" },
        },
      },
    };
    const preview = await previewSessionBindings({ root: f.root, mapping });
    await expect(
      applySessionBindings({
        preview,
        maintenance: false,
        backupConfirmed: true,
      })
    ).rejects.toThrow("maintenance");
    await expect(
      applySessionBindings({
        preview,
        maintenance: true,
        backupConfirmed: false,
      })
    ).rejects.toThrow("backup");
    expect(
      await applySessionBindings({
        preview,
        maintenance: true,
        backupConfirmed: true,
      })
    ).toMatchObject({ phase: "committed" });
    const opened = await f.open();
    try {
      expect(
        (
          await new InferenceSessionRepository(
            () => opened.database.state
          ).read(f.identity)
        )?.selection
      ).toEqual({ kind: "inherit" });
    } finally {
      await opened.close();
    }
  } finally {
    await f.close();
  }
});

it("defers non-SQLite target validation using only the existing explicit source snapshot, with no connection or credential access", async () => {
  const f = await fixture(),
    fetch = vi.spyOn(globalThis, "fetch");
  try {
    const opened = await f.open();
    let row;
    try {
      row = await opened.database.state!.read(
        rootPluginId(),
        { kind: "plugin" },
        f.identity.key
      );
    } finally {
      await opened.close();
    }
    const { legacyPluginStateId } = await import(
      "../../../src/plugin-runtime/inference/migration-source.js"
    );
    const snapshot = join(f.root, "source-snapshot.json");
    await writeFile(
      snapshot,
      JSON.stringify({
        version: 1,
        rootId: f.root,
        rows: [
          {
            id: legacyPluginStateId(f.identity.key),
            revision: row!.revision,
            value: row!.value,
            expiresAt: null,
          },
        ],
      })
    );
    await writeFile(
      f.file,
      JSON.stringify({
        ...f.document,
        database: {
          dialect: "mysql",
          host: "must-not-connect.example",
          user: "synthetic",
          password: "synthetic-private-db-value",
          database: "fixture",
        },
      })
    );
    const preview = await previewSessionBindings({
      root: f.root,
      mapping: f.mapping,
      stateSnapshot: snapshot,
    });
    expect(preview.targetValidation).toBe("deferred-until-apply");
    expect(JSON.stringify(preview)).not.toContain("synthetic-private-db-value");
    expect(JSON.stringify(preview)).not.toContain("must-not-connect.example");
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      access(join(f.root, ".zhin", "inference"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    fetch.mockRestore();
    await f.close();
  }
});

it.each(["owner", "incarnation", "source-revision"] as const)(
  "revalidates %s after preview before the first Session CAS",
  async (problem) => {
    const f = await fixture();
    try {
      const preview = await previewSessionBindings({
        root: f.root,
        mapping: f.mapping,
      });
      if (problem === "owner")
        await writeFile(
          f.file,
          JSON.stringify({
            ...f.document,
            ai: { enabled: true, personalPrincipals: {} },
          })
        );
      const opened = await f.open();
      try {
        if (problem === "incarnation")
          await opened.host.repository.commit({
            rootId: f.root,
            expectedRevision: 1,
            mutationId: "replace-account",
            fingerprint: "replace-account",
            result: null,
            graph: {
              ...f.graph,
              revision: 2,
              accounts: {
                account: {
                  ...f.graph.accounts.account,
                  revision: 2,
                  incarnation: "replacement",
                },
              },
            },
          });
        if (problem === "source-revision") {
          const state = opened.database.state!,
            current = (await state.read(
              rootPluginId(),
              { kind: "plugin" },
              f.identity.key
            ))!;
          await state.compareExchange(
            rootPluginId(),
            { kind: "plugin" },
            f.identity.key,
            current.revision,
            current.value,
            null
          );
        }
      } finally {
        await opened.close();
      }
      const submit = vi.spyOn(journals, "applyMigrationSessionJournal");
      try {
        await expect(
          applySessionBindings({
            preview,
            maintenance: true,
            backupConfirmed: true,
          })
        ).rejects.toThrow();
        expect(submit).not.toHaveBeenCalled();
      } finally {
        submit.mockRestore();
      }
      const checked = await f.open();
      try {
        expect(
          (await checked.database.state!.read(
            rootPluginId(),
            { kind: "plugin" },
            f.identity.key
          ))!.value
        ).toMatchObject({ version: 1 });
      } finally {
        await checked.close();
      }
    } finally {
      await f.close();
    }
  }
);

it('validates every selected target before writing even the first otherwise-valid Session', async () => {
  const f = await fixture();
  try {
    const identity = personalSessionIdentity({ ...f.identity.address, conversation: { ...f.identity.address.conversation, threadId: 'another-thread' } });
    const account = { ...f.graph.accounts.account, id: 'second-account', incarnation: 'second-original' }, profile = { ...f.graph.profiles.profile, id: 'second-profile', accountId: account.id };
    const graph = { ...f.graph, revision: 2, accounts: { ...f.graph.accounts, [account.id]: account }, profiles: { ...f.graph.profiles, [profile.id]: profile } };
    const opened = await f.open(); let revision: string;
    try {
      await opened.host.repository.commit({ rootId: f.root, expectedRevision: 1, mutationId: 'second', fingerprint: 'second', result: null, graph });
      const state = opened.database.state!;
      await state.compareExchange(rootPluginId(), { kind: 'plugin' }, identity.key, undefined, JSON.parse(JSON.stringify({ version: 1, kind: 'personal-session', state: { identity, revision: 1, selection: { kind: 'inherit' } } })), null);
      revision = (await state.read(rootPluginId(), { kind: 'plugin' }, identity.key))!.revision;
    } finally { await opened.close(); }
    const mapping = { version: 1, sessions: { ...f.mapping.sessions, [identity.key]: { sourceRevision: revision, selection: { kind: 'profile', profile: persistentProfileSelection(createProfileReference({ kind: 'language', binding: { graphRevision: 2, service: graph.services.service, account, profile, model: graph.services.service.models.native } })) } } } };
    const preview = await previewSessionBindings({ root: f.root, mapping });
    const changed = await f.open();
    try { await changed.host.repository.commit({ rootId: f.root, expectedRevision: 2, mutationId: 'replace-second', fingerprint: 'replace-second', result: null, graph: { ...graph, revision: 3, accounts: { ...graph.accounts, [account.id]: { ...account, revision: 2, incarnation: 'replacement' } } } }); }
    finally { await changed.close(); }
    const submit = vi.spyOn(journals, 'applyMigrationSessionJournal');
    try { await expect(applySessionBindings({ preview, maintenance: true, backupConfirmed: true })).rejects.toThrow(); expect(submit).not.toHaveBeenCalled(); }
    finally { submit.mockRestore(); }
    const check = await f.open();
    try { for (const key of [f.identity.key, identity.key]) expect((await check.database.state!.read(rootPluginId(), { kind: 'plugin' }, key))!.value).toMatchObject({ version: 1 }); }
    finally { await check.close(); }
  } finally { await f.close(); }
});

it.each(['valid', 'wrong-incarnation'] as const)('checks deferred targets at apply through the database port (%s)', async target => {
  const f = await fixture();
  try {
    const opened = await f.open(); let row;
    try { row = await opened.database.state!.read(rootPluginId(), { kind: 'plugin' }, f.identity.key); }
    finally { await opened.close(); }
    const { legacyPluginStateId } = await import('../../../src/plugin-runtime/inference/migration-source.js');
    const snapshot = join(f.root, 'selected-source.json');
    await writeFile(snapshot, JSON.stringify({ version: 1, rootId: f.root, rows: [{ id: legacyPluginStateId(f.identity.key), revision: row!.revision, value: row!.value, expiresAt: null }] }));
    await writeFile(f.file, JSON.stringify({ ...f.document, database: { dialect: 'mysql', host: 'not-connected.example', user: 'synthetic', database: 'fixture' } }));
    const mapping = structuredClone(f.mapping);
    if (target === 'wrong-incarnation') mapping.sessions[f.identity.key].selection.profile = { ...mapping.sessions[f.identity.key].selection.profile, accountIncarnation: 'wrong' };
    const preview = await previewSessionBindings({ root: f.root, mapping, stateSnapshot: snapshot });
    expect(preview.targetValidation).toBe('deferred-until-apply');
    const headless = await import('@zhin.js/agent/runtime'), original = headless.openHeadlessInferenceHost;
    // This is a database-port contract backed by real SQLite, not a live MySQL test.
    const connect = vi.spyOn(headless, 'openHeadlessInferenceHost').mockImplementation(input => {
      expect(input.officialDrivers).toBe(false); expect(input.database.dialect).toBe('mysql');
      return original({ ...input, database: { dialect: 'sqlite', filename: f.filename } });
    });
    const submit = vi.spyOn(journals, 'applyMigrationSessionJournal');
    try {
      const result = applySessionBindings({ preview, maintenance: true, backupConfirmed: true });
      if (target === 'valid') { expect(await result).toMatchObject({ phase: 'committed', migratedSessions: 1 }); expect(submit).toHaveBeenCalledOnce(); }
      else { await expect(result).rejects.toThrow(); expect(submit).not.toHaveBeenCalled(); }
    } finally { submit.mockRestore(); connect.mockRestore(); }
  } finally { await f.close(); }
});

it('refuses inherited dry-run before the real CLI can apply a Session-only preview', async () => {
  const f = await fixture();
  try {
    const preview = await previewSessionBindings({ root: f.root, mapping: f.mapping });
    const file = join(f.root, 'session-preview.json'),
      before = await readFile(f.filename);
    await writeFile(file, JSON.stringify(preview));
    const repo = resolve(import.meta.dirname, '../../../../..');
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          '--conditions=development',
          '--import',
          join(repo, 'node_modules/tsx/dist/esm/index.mjs'),
          join(repo, 'basic/cli/src/cli.ts'),
          'migrate',
          '--dry-run',
          'inference',
          '--apply',
          file,
          '--maintenance',
          '--backup-confirmed',
        ],
        {
          cwd: f.root,
          env: { PATH: process.env.PATH ?? '', HOME: f.root, GROQ_API_KEY: '', NODE_OPTIONS: '' },
        }
      )
    ).rejects.toThrow('--dry-run');
    expect(await readFile(f.filename)).toEqual(before);
    await expect(
      access(join(f.root, '.zhin', 'inference-session-bindings', preview.id))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await f.close();
  }
});
