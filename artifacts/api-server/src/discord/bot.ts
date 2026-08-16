import { randomInt } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  gte,
} from "drizzle-orm";
import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type User,
} from "discord.js";
import {
  db,
  guildSettingsTable,
  vouchesTable,
  type GuildSettings,
} from "@workspace/db";
import { logger } from "../lib/logger";

const SUCCESS_COLOR = 0x57f287;
const INFO_COLOR = 0x5865f2;
const ERROR_COLOR = 0xed4245;

const slashCommands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("View your pending vouches or look up one by ID")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("The vouch ID from your confirmation DM")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Show the members with the most vouches"),
  new SlashCommandBuilder()
    .setName("hot")
    .setDescription("Show the most active members from the last 7 days"),
  new SlashCommandBuilder()
    .setName("set")
    .setDescription("Configure vouch notifications and roles")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channel")
        .setDescription("Set the channel for vouch notifications")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Notification channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("dwc")
        .setDescription("Set the DWC role")
        .addRoleOption((option) =>
          option.setName("role").setDescription("DWC role").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("scammer")
        .setDescription("Set the scammer role")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("Scammer role")
            .setRequired(true),
        ),
    ),
].map((command) => command.toJSON());

function displayName(user: User): string {
  return user.globalName ?? user.username;
}

function formatVouchId(code: string): string {
  return `\`${code}\``;
}

function createCode(): string {
  return randomInt(100000, 10000000).toString();
}

function profileId(guildId: string, userId: string): string {
  let hash = 0;
  for (const character of `${guildId}:${userId}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return String(Math.abs(hash) % 1000000).padStart(6, "0");
}

function profileFooterDate(): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

async function createUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createCode();
    const existing = await db
      .select({ id: vouchesTable.id })
      .from(vouchesTable)
      .where(eq(vouchesTable.code, code))
      .limit(1);
    if (existing.length === 0) {
      return code;
    }
  }

  throw new Error("Unable to create a unique vouch ID");
}

function extractAmount(text: string): string | null {
  const matches = [...text.matchAll(/(?:[$€£₹]?\s*)\d+(?:[.,]\d{1,2})?\s*[$€£₹]?/g)];
  const lastMatch = matches.at(-1);
  return lastMatch?.[0].replace(/\s+/g, "").replace(",", ".") ?? null;
}

function parseTargetToken(token: string): string | null {
  const mention = token.match(/^<@!?(\d+)>$/);
  if (mention) {
    return mention[1];
  }

  return /^\d{15,25}$/.test(token) ? token : null;
}

async function fetchTargetUser(
  message: Message,
  token: string,
): Promise<User | null> {
  const userId = parseTargetToken(token);
  if (!userId) {
    return null;
  }

  const mentioned = message.mentions.users.get(userId);
  if (mentioned) {
    return mentioned;
  }

  try {
    return await message.client.users.fetch(userId);
  } catch {
    return null;
  }
}

async function getSettings(guildId: string): Promise<GuildSettings | null> {
  const [settings] = await db
    .select()
    .from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guildId))
    .limit(1);
  return settings ?? null;
}

async function updateSettings(
  guildId: string,
  changes: Partial<
    Pick<
      GuildSettings,
      "notificationChannelId" | "dwcRoleId" | "scammerRoleId"
    >
  >,
): Promise<void> {
  const existing = await getSettings(guildId);
  if (existing) {
    await db
      .update(guildSettingsTable)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(guildSettingsTable.guildId, guildId));
    return;
  }

  await db.insert(guildSettingsTable).values({
    guildId,
    notificationChannelId: changes.notificationChannelId ?? null,
    dwcRoleId: changes.dwcRoleId ?? null,
    scammerRoleId: changes.scammerRoleId ?? null,
  });
}

function vouchEmbed(
  target: User,
  details: string,
  code: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(INFO_COLOR)
    .setTitle("Vouch submitted")
    .setDescription(
      `Vouch ${formatVouchId(code)} submitted for ${target}.`,
    )
    .addFields(
      { name: "Details", value: details, inline: false },
      { name: "Status", value: "Received", inline: true },
    )
    .setTimestamp();
}

async function sendVouchNotification(
  guildId: string,
  target: User,
  details: string,
  code: string,
): Promise<void> {
  const settings = await getSettings(guildId);
  if (!settings?.notificationChannelId) {
    return;
  }

  const channel = await target.client.channels
    .fetch(settings.notificationChannelId)
    .catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  await channel
    .send({ embeds: [vouchEmbed(target, details, code)] })
    .catch((error: unknown) => {
      logger.warn({ error, guildId }, "Unable to send vouch notification");
    });
}

async function submitMemberVouch(message: Message): Promise<void> {
  if (!message.guild) {
    return;
  }

  const tokens = message.content.trim().split(/\s+/);
  const targetToken = tokens[1];
  const details = tokens.slice(2).join(" ").trim();
  if (!targetToken || !details) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            "Usage: `+rep @user product name amount`",
          ),
      ],
    });
    return;
  }

  const target = await fetchTargetUser(message, targetToken);
  if (!target || target.bot) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription("Please mention a valid member to receive the vouch."),
      ],
    });
    return;
  }

  const amount = extractAmount(details);
  if (!amount) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription(
            "Your vouch must include a number (amounts, e.g. `$13 LTC to $12 INR`).",
          ),
      ],
    });
    return;
  }

  if (details.length > 500) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription("Your vouch details must be 500 characters or fewer."),
      ],
    });
    return;
  }

  const code = await createUniqueCode();
  await db.insert(vouchesTable).values({
    code,
    guildId: message.guild.id,
    targetUserId: target.id,
    targetUsername: displayName(target),
    giverUserId: message.author.id,
    giverUsername: displayName(message.author),
    product: details,
    amount,
    status: "pending",
    source: "member",
  });

  await message.react("✅").catch(() => undefined);
  await message.reply({
    embeds: [vouchEmbed(target, details, code)],
  });

  await target
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(SUCCESS_COLOR)
          .setDescription(
            [
              `**${code} — Received**`,
              "",
              "────────────────────────",
              "",
              `> ${details}`,
              "",
              "────────────────────────",
              "",
              `Sent by \`${displayName(message.author)}\` •`,
              `\`${message.author.id}\``,
            ].join("\n"),
          )
      ],
    })
    .catch(() => undefined);

  await sendVouchNotification(message.guild.id, target, details, code);
}

async function showProfile(message: Message): Promise<void> {
  if (!message.guild) {
    return;
  }

  const args = message.content.trim().split(/\s+/).slice(1);
  if (args.length > 1) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription("Usage: `+p` or `+p @user`."),
      ],
    });
    return;
  }

  const targetId = args[0]
    ? parseTargetToken(args[0])
    : message.author.id;
  if (!targetId) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription("Mention a member or provide a valid user ID."),
      ],
    });
    return;
  }

  const target = await message.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ERROR_COLOR)
          .setDescription("I couldn't find that Discord user."),
      ],
    });
    return;
  }

  const [totalRows, lastSevenRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(vouchesTable)
      .where(
        and(
          eq(vouchesTable.guildId, message.guild.id),
          eq(vouchesTable.targetUserId, target.id),
        ),
      ),
    db
      .select({ total: count() })
      .from(vouchesTable)
      .where(
        and(
          eq(vouchesTable.guildId, message.guild.id),
          eq(vouchesTable.targetUserId, target.id),
          gte(
            vouchesTable.createdAt,
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          ),
        ),
      ),
  ]);

  const total = totalRows[0]?.total ?? 0;
  const lastSeven = lastSevenRows[0]?.total ?? 0;
  const embed = new EmbedBuilder()
    .setColor(INFO_COLOR)
    .setTitle(`${displayName(target)}'s Profile`)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(
      [
        `**ID:** ${formatVouchId(target.id)}`,
        `**PID:** ${formatVouchId(profileId(message.guild.id, target.id))}`,
        `**Name:** ${displayName(target)} • ${target}`,
        "",
        "────────────────────────",
        "",
        "__Badges__",
        "_No badges._",
        "",
        "────────────────────────",
        "",
        "__Vouch Information__",
        `**Vouches:** ${total}`,
        `**Last 7 Days:** ${lastSeven}`,
      ].join("\n"),
    );
  embed.setFooter({ text: `Swift • ${profileFooterDate()}` });

  await message.reply({ embeds: [embed] });
}

async function showLeaderboard(
  interaction: ChatInputCommandInteraction,
  hot: boolean,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      ephemeral: true,
    });
    return;
  }

  const since = hot ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : null;
  const rows = await db
    .select({
      userId: vouchesTable.targetUserId,
      username: vouchesTable.targetUsername,
      total: count(),
    })
    .from(vouchesTable)
    .where(
      since
        ? and(
            eq(vouchesTable.guildId, interaction.guild.id),
            gte(vouchesTable.createdAt, since),
          )
        : eq(vouchesTable.guildId, interaction.guild.id),
    )
    .groupBy(vouchesTable.targetUserId, vouchesTable.targetUsername)
    .orderBy(desc(count()))
    .limit(10);

  const lines = rows.length
    ? rows.map(
        (row, index) =>
          `**${index + 1}.** <@${row.userId}> — **${row.total}** vouch${row.total === 1 ? "" : "es"}`,
      )
    : ["No vouches have been recorded yet."];

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(INFO_COLOR)
        .setTitle(hot ? "Hot vouches" : "Top vouched all time")
        .setDescription(lines.join("\n"))
        .setFooter({
          text: hot ? "Based on the last 7 days." : "All recorded vouches are shown.",
        })
        .setTimestamp(),
    ],
  });
}

async function showStatus(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      ephemeral: true,
    });
    return;
  }

  const code = interaction.options.getString("id");
  const rows = code
    ? await db
        .select()
        .from(vouchesTable)
        .where(
          and(
            eq(vouchesTable.guildId, interaction.guild.id),
            eq(vouchesTable.code, code.replace(/`/g, "")),
          ),
        )
        .limit(1)
    : await db
        .select()
        .from(vouchesTable)
        .where(
          and(
            eq(vouchesTable.guildId, interaction.guild.id),
            eq(vouchesTable.giverUserId, interaction.user.id),
            eq(vouchesTable.status, "pending"),
          ),
        )
        .orderBy(desc(vouchesTable.createdAt))
        .limit(10);

  if (!rows.length) {
    await interaction.reply({
      content: code
        ? "I couldn't find a vouch with that ID in this server."
        : "You have no pending vouches.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(INFO_COLOR)
    .setTitle(code ? "Vouch status" : "Your pending vouches")
    .setDescription(
      rows
        .map(
          (row) =>
            `${formatVouchId(row.code)} — **${row.status === "pending" ? "Received" : row.status}**\n${row.product}\nFor <@${row.targetUserId}>`,
        )
        .join("\n\n"),
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSetCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.guild ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: "Only server administrators can change vouch settings.",
      ephemeral: true,
    });
    return;
  }

  const setting = interaction.options.getSubcommand();
  if (setting === "channel") {
    const channel = interaction.options.getChannel("channel", true);
    await updateSettings(interaction.guild.id, {
      notificationChannelId: channel.id,
    });
    await interaction.reply({
      content: `Vouch notifications will now be sent to <#${channel.id}>.`,
      ephemeral: true,
    });
    return;
  }

  const role = interaction.options.getRole("role", true);
  if (setting === "dwc") {
    await updateSettings(interaction.guild.id, { dwcRoleId: role.id });
    await interaction.reply({
      content: `DWC role set to <@&${role.id}>.`,
      ephemeral: true,
    });
    return;
  }

  await updateSettings(interaction.guild.id, { scammerRoleId: role.id });
  await interaction.reply({
    content: `Scammer role set to <@&${role.id}>.`,
    ephemeral: true,
  });
}

async function registerCommands(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const existing = await guild.commands.fetch();
    for (const command of slashCommands) {
      const previous = existing.find((item) => item.name === command.name);
      if (previous) {
        await previous.delete();
        await guild.commands.create(command);
      } else {
        await guild.commands.create(command);
      }
    }
  }
}

function registerEventHandlers(client: Client): void {
  client.on("messageCreate", (message) => {
    if (message.author.bot || !message.guild) {
      return;
    }

    if (/^\+rep(?:\s|$)/i.test(message.content.trim())) {
      void submitMemberVouch(message).catch((error: unknown) => {
        logger.error({ error }, "Failed to process member vouch");
      });
      return;
    }

    if (/^\+p(?:\s|$)/i.test(message.content.trim())) {
      void showProfile(message).catch((error: unknown) => {
        logger.error({ error }, "Failed to process profile lookup");
      });
    }
  });

  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const handler =
      interaction.commandName === "status"
        ? showStatus(interaction)
        : interaction.commandName === "top"
          ? showLeaderboard(interaction, false)
          : interaction.commandName === "hot"
            ? showLeaderboard(interaction, true)
              : interaction.commandName === "set"
                ? handleSetCommand(interaction)
                : Promise.resolve();

    void handler.catch(async (error: unknown) => {
      logger.error(
        { error, command: interaction.commandName },
        "Failed to process slash command",
      );
      if (interaction.replied || interaction.deferred) {
        await interaction
          .editReply("Something went wrong while processing that command.")
          .catch(() => undefined);
      } else {
        await interaction
          .reply({
            content: "Something went wrong while processing that command.",
            ephemeral: true,
          })
          .catch(() => undefined);
      }
    });
  });
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN is not configured; Discord bot is disabled");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  registerEventHandlers(client);
  client.once("clientReady", (readyClient) => {
    void registerCommands(readyClient)
      .then(() => {
        logger.info(
          {
            botUserId: readyClient.user.id,
            guilds: readyClient.guilds.cache.size,
          },
          "Discord vouch bot is ready",
        );
      })
      .catch((error: unknown) => {
        logger.error({ error }, "Failed to register Discord slash commands");
      });
  });
  client.on("guildCreate", (guild) => {
    void registerCommands(client).catch((error: unknown) => {
      logger.error(
        { error, guildId: guild.id },
        "Failed to register commands for new guild",
      );
    });
  });

  await client.login(token);
}