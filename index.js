const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const mongoose = require("mongoose");

// 🤖 CLIENTE
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User]
});

// 🔐 CANAL PERMITIDO (para el resto de comandos)
const ALLOWED_CHANNEL = "1519418226973347992";

// 🔐 ROLES
const TOKENS_ROLE = "1517347810167619697";
const PRISON_ROLE = "1459458843816759412";
const IMMUNITY_ROLE = "1515011976621854790";
const SHIELD_ROLE = "1449488332273877153";
const BOOSTER_ROLE = "1427099549364781127";
const EXTRA_ROLE = "1426678812443148430";
const CUSTOMIZER_ROLE = "1521909178380062920";
const CUSTOMIZER_USED_ROLE = "1521269126612385811";
const TOKEN_TIER2_ROLE = "1521909363592400937";
const ADMIN_ROLE = "1514290226946641960";
const ARBITER_ROLE = "1434634809434575011";

// 🎨 BOOSTER COLORS
const BOOSTER_COLORS = [
  "1520940230222282872",
  "1520940500465745951",
  "1520940358215929996",
  "1520940313844387880",
  "1520940407779754128"
];

const BOOSTER_OPTIONS = {
  blue: "1520940230222282872",
  green: "1520940500465745951",
  pink: "1520940358215929996",
  red: "1520940313844387880",
  yellow: "1520940407779754128"
};

const CUSTOMIZER_COLORS = [
  "1529597738231005244",
  "1529597610325839953",
  "1529597513848328273",
  "1529597569788018928",
  "1529597446320033872"
];

const CUSTOMIZER_OPTIONS = {
  black: "1529597738231005244",
  blue: "1529597610325839953",
  purple: "1529597513848328273",
  green: "1529597569788018928",
  red: "1529597446320033872"
};

// 🛡️ INMUNIDADES
const IMMUNE_ROLES = [
  "1465082323220562013",
  "1426385179575975936",
  "1427393145993429063",
  "1427099549364781127"
];

// 📦 MONGO
if (!process.env.MONGO_URI) {
  console.log("❌ MONGO_URI no definida en las variables de entorno");
} else {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("📦 MongoDB conectado"))
    .catch(err => console.log("❌ Mongo error:", err));
}

// 📌 SCHEMAS
const roleTimerSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  roleId: String,
  type: String,
  data: Object,
  expiresAt: Date
});

const RoleTimer = mongoose.models.RoleTimer || mongoose.model("RoleTimer", roleTimerSchema);

const backpackSchema = new mongoose.Schema({
  userId: String,
  tokens: {
    type: Number,
    default: 0
  }
});

const Backpack = mongoose.models.Backpack || mongoose.model("Backpack", backpackSchema);

// ⏱️ COOLDOWNS & MAPS
const cooldown = new Map();
const rainbowIntervals = new Map();
const activeDuels = new Map();

// 🎲 RANDOM NAMES
const randomNames = [
  "Sombra", "Fénix", "Rayo", "Titán", "Nómada",
  "Cazador", "Fantasma", "Vortex", "Draco", "Orion",
  "Lobo", "Ángel", "Demonio", "Neón", "Eco"
];

// 🧠 TOKEN CONSUMER
async function consumeToken(member) {
  if (!member.roles.cache.has(TOKENS_ROLE)) return false;
  try {
    await member.roles.remove(TOKENS_ROLE);
    return true;
  } catch {
    return false;
  }
}

// 🌈 RAINBOW SYSTEM
function startRainbow(member) {
  if (rainbowIntervals.has(member.id)) {
    clearInterval(rainbowIntervals.get(member.id));
  }

  let index = 0;

  const changeColor = async () => {
    try {
      await member.roles.remove(BOOSTER_COLORS).catch(() => {});
      await member.roles.add(BOOSTER_COLORS[index]).catch(() => {});
      index = (index + 1) % BOOSTER_COLORS.length;
    } catch {}
  };

  changeColor();
  const interval = setInterval(changeColor, 7000);
  rainbowIntervals.set(member.id, interval);
}

// 💾 TIMER UNIVERSAL
async function addTimer(member, type, roleId, ms, data = {}) {
  const expiresAt = new Date(Date.now() + ms);

  await RoleTimer.create({
    guildId: member.guild.id,
    userId: member.id,
    roleId,
    type,
    data,
    expiresAt
  });

  if (roleId) {
    await member.roles.add(roleId).catch(() => {});
  }
}

// 🧹 CHECK EXPIRATIONS
async function checkTimers() {
  const now = new Date();
  const expired = await RoleTimer.find({ expiresAt: { $lte: now } });

  for (const t of expired) {
    try {
      const guild = await client.guilds.fetch(t.guildId);
      const member = await guild.members.fetch(t.userId).catch(() => null);

      if (!member) continue;

      if (["prison", "immunity", "shield", "extras", "customizer"].includes(t.type) && t.roleId) {
        await member.roles.remove(t.roleId).catch(() => {});
      }

      if (t.type === "rainbow") {
        if (rainbowIntervals.has(member.id)) {
          clearInterval(rainbowIntervals.get(member.id));
          rainbowIntervals.delete(member.id);
        }
        await member.roles.remove(BOOSTER_COLORS).catch(() => {});
      }

      if (t.type === "rename" || t.type === "randomname") {
        if (member.manageable && t.data?.oldName) {
          await member.setNickname(t.data.oldName).catch(() => {});
        }
      }

      await RoleTimer.deleteOne({ _id: t._id });
    } catch {}
  }
}

// ❓ ENVIAR PREGUNTA Y TEMPORIZADOR DE 15s (SISTEMA DE RETOS)
async function sendDuelQuestion(channel, duelId) {
  const duel = activeDuels.get(duelId);
  if (!duel) return;

  const qIndex = duel.currentQuestion;
  const currentQ = duel.questions[qIndex];

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ PREGUNTA ${qIndex + 1} / 3`)
    .setDescription(
      `**${currentQ}**\n\n` +
      `👥 **Retados:** <@${duel.users[0]}> VS <@${duel.users[1]}>\n` +
      `⏳ **Tiempo:** 15 Segundos\n\n` +
      `*El árbitro <@${duel.arbiterId}> reaccionará con ✅ al mensaje con la respuesta correcta.*`
    )
    .setColor(0x3b82f6);

  await channel.send({ embeds: [embed] });

  if (duel.timer) clearTimeout(duel.timer);

  duel.timer = setTimeout(async () => {
    await channel.send(`⏳ **¡Tiempo agotado!** Se reinician 15s para la Pregunta ${qIndex + 1}...`);
    sendDuelQuestion(channel, duelId);
  }, 15000);
}

// 🏆 FINALIZAR DUELO Y CAMBIAR ROLES
async function finishDuel(channel, duelId, winnerId) {
  const duel = activeDuels.get(duelId);
  if (!duel) return;

  const loserId = duel.users.find(id => id !== winnerId);
  const loserRole = loserId === duel.users[0] ? duel.roles[0] : duel.roles[1];

  try {
    const guild = channel.guild;
    const winnerMember = await guild.members.fetch(winnerId);
    const loserMember = await guild.members.fetch(loserId);

    await loserMember.roles.remove(loserRole).catch(() => {});
    await winnerMember.roles.add(loserRole).catch(() => {});

    const winEmbed = new EmbedBuilder()
      .setTitle("🏆 ¡TENEMOS UN GANADOR DEL RETO!")
      .setDescription(
        `🎉 **Ganador:** <@${winnerId}>\n` +
        `💀 **Perdedor:** <@${loserId}>\n\n` +
        `🔄 **Transferencia de Apuesta:**\n` +
        `• A <@${loserId}> se le retiró el rol <@&${loserRole}>\n` +
        `• <@${winnerId}> recibió el rol <@&${loserRole}>`
      )
      .setColor(0x22c55e);

    await channel.send({ embeds: [winEmbed] });
  } catch (e) {
    console.error("Error al transferir roles:", e);
    await channel.send("❌ Hubo un fallo al intentar transferir los roles.");
  } finally {
    activeDuels.delete(duelId);
  }
}

// 🟣 MESSAGE SYSTEM
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(">")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args[0].toLowerCase();

  // 🌍 COMANDOS GLOBALES (Se pueden usar en CUALQUIER canal)
  const globalCommands = ["retar", "booster", "personalizar"];

  // Si NO es un comando global Y tampoco estamos en el canal permitido, ignorar
  if (!globalCommands.includes(command) && message.channel.id !== ALLOWED_CHANNEL) {
    return;
  }

  const now = Date.now();
  const cd = cooldown.get(message.author.id) || 0;

  if (now - cd < 5000) return;
  cooldown.set(message.author.id, now);

  // ⚔️ >retar
  if (command === "retar") {
    const isOwner = message.guild.ownerId === message.author.id;
    const isAdmin = message.member.permissions.has("Administrator");
    const hasArbiterRole = message.member.roles.cache.has(ARBITER_ROLE);

    if (!isOwner && !isAdmin && !hasArbiterRole) {
      return message.reply("❌ No tienes el rol de Árbitro ni permisos suficientes para crear retos.");
    }

    const embed = new EmbedBuilder()
      .setTitle("⚔️ SISTEMA DE RETOS Y APUESTAS")
      .setDescription(
        "Configura el reto seleccionando a los 2 usuarios y los roles que van a apostar.\n\n" +
        "1️⃣ Selecciona **Usuario 1** y **Usuario 2**.\n" +
        "2️⃣ Selecciona el **Rol apostado de cada uno**."
      )
      .setColor(0xeab308);

    const userSelect = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("duel_users")
        .setPlaceholder("Selecciona los 2 usuarios retados")
        .setMinValues(2)
        .setMaxValues(2)
    );

    const roleSelect = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("duel_roles")
        .setPlaceholder("Selecciona los 2 roles en juego")
        .setMinValues(2)
        .setMaxValues(2)
    );

    const startBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("duel_setup_questions")
        .setLabel("📝 Definir 3 Preguntas")
        .setStyle(ButtonStyle.Success)
    );

    activeDuels.set(`setup_${message.author.id}`, {
      arbiterId: message.author.id,
      users: [],
      roles: [],
      questions: [],
      scores: {},
      currentQuestion: 0,
      timer: null
    });

    return message.reply({ embeds: [embed], components: [userSelect, roleSelect, startBtn] });
  }

  // 🎨 >booster
  if (command === "booster") {
    const member = message.member;
    const isAdmin = member.roles.cache.has(ADMIN_ROLE);
    const hasBooster = member.roles.cache.has(BOOSTER_ROLE) || BOOSTER_COLORS.some(id => member.roles.cache.has(id));

    if (!isAdmin && !hasBooster) {
      return message.reply("❌ Solo Booster o Administradores pueden usar este comando.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🎨 BOOSTER CUSTOMIZER")
      .setDescription("Selecciona el color de tu Booster.\n\n• Solo puedes tener un color activo.\n• Puedes cambiarlo cuando quieras.\n• Booster por defecto elimina el color actual.\n\n✨ Uso ilimitado.")
      .setImage("https://cdn.discordapp.com/attachments/1402268718360297544/1520983770554175640/3861EA98-7752-4D92-A8B4-70BAC6FA999E.gif");

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("booster_menu")
        .setPlaceholder("Selecciona un Booster")
        .addOptions([
          { label: "Booster Azul", value: "blue", emoji: "🔵" },
          { label: "Booster Verde", value: "green", emoji: "🟢" },
          { label: "Booster Rosa", value: "pink", emoji: "🩷" },
          { label: "Booster Rojo", value: "red", emoji: "🔴" },
          { label: "Booster Amarillo", value: "yellow", emoji: "🟡" },
          { label: "Rainbow Color", value: "rainbow", emoji: "🌈" },
          { label: "Booster por defecto", value: "default", emoji: "♻️" }
        ])
    );

    return message.reply({ embeds: [embed], components: [menu] });
  }

  // 🎒 >mochila
  if (command === "mochila") {
    let data = await Backpack.findOne({ userId: message.author.id });
    if (!data) {
      data = await Backpack.create({ userId: message.author.id, tokens: 0 });
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🎒 TU MOCHILA")
      .setDescription(`📀 Tokens guardados: **${data.tokens}**\n\nUsa \`>use token\` para convertir un Token guardado en un Token utilizable.`);

    return message.reply({ embeds: [embed] });
  }

  // 🎟️ >use token
  if (command === "use" && args[1]?.toLowerCase() === "token") {
    if (message.member.roles.cache.has(TOKENS_ROLE)) {
      return message.reply("❌ Ya tienes un Token activo.");
    }

    let data = await Backpack.findOne({ userId: message.author.id });
    if (!data || data.tokens <= 0) {
      return message.reply("❌ No tienes Tokens en tu mochila.");
    }

    data.tokens -= 1;
    await data.save();
    await message.member.roles.add(TOKENS_ROLE).catch(() => {});

    return message.reply(`✅ Has usado 1 Token.\n🎒 Tokens restantes: **${data.tokens}**`);
  }

  // 🎨 >personalizar
  if (command === "personalizar") {
    const member = message.member;
    if (!member.roles.cache.has(CUSTOMIZER_USED_ROLE)) {
      return message.reply("❌ Necesitas tener un Personalizador activo para usar este comando.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("🎨 PERSONALIZADOR")
      .setDescription("Selecciona el color que deseas usar.\n\n• Solo puedes tener un color activo.\n• Puedes cambiarlo cuando quieras mientras tu Personalizador esté activo.\n• La opción por defecto elimina el color actual.");

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("customizer_menu")
        .setPlaceholder("Selecciona un color")
        .addOptions([
          { label: "Negro", value: "black", emoji: "⚫" },
          { label: "Azul", value: "blue", emoji: "🔵" },
          { label: "Morado", value: "purple", emoji: "🟣" },
          { label: "Verde", value: "green", emoji: "🟢" },
          { label: "Rojo", value: "red", emoji: "🔴" },
          { label: "Color por defecto", value: "default", emoji: "♻️" }
        ])
    );

    return message.reply({ embeds: [embed], components: [menu] });
  }

  // 🛒 >call mechanic
  if (command === "call" && args[1]?.toLowerCase() === "mechanic") {
    if (!message.member.roles.cache.has(TOKENS_ROLE)) {
      return message.reply("🤖 vuelve cuando tengas un token.");
    }

    const loading = await message.channel.send("🟣 ⚙️ iniciando sistema...");
    await new Promise(r => setTimeout(r, 1200));

    const embed = new EmbedBuilder()
      .setTitle("🛒 ⚙️ THE MECHANIC STORE")
      .setDescription(
        "```yaml\n" +
        "🔗 ENCANDENAMIENTO\n🪙 1 TOKEN\n⏳ 5 min\n⚙️ bloquea acceso a interacciones básicas del sistema\n🔗 efecto temporal de restricción de canales\n\n" +
        "⛓️ LIBERACIÓN\n🪙 1 TOKEN\n⚙️ elimina el efecto de encadenamiento\n⛓️‍💥 restaura el acceso normal del usuario\n\n" +
        "✏️ RENOMBRAR USUARIO\n🪙 1 TOKEN\n⏳ 1 min\n⚙️ cambia el nickname del usuario temporalmente\n✨ vuelve al nombre original al finalizar\n\n" +
        "🛠️ PERMISOS EXTRAS\n🪙 1 TOKEN\n⏳ 1 HORA\n⚙️ permisos temporales avanzados\n\n" +
        "🎲 NOMBRES ALEATORIOS\n🪙 1 TOKEN\n⏳ 1 min\n⚙️ cambia el nombre del usuario constantemente\n\n" +
        "🛡️ INMUNIDAD CD\n🪙 1 TOKEN\n⏳ 1 HORA\n⚙️ te da inmunidad al modo lento\n\n" +
        "🛡️ ESCUDO\n🪙 1 TOKEN\n⏳ 1 HORA\n⚙️ te protege contra cualquier efecto\n\n" +
        "🎨 PERSONALIZADOR\n🪙 1 PERSONALIZADOR\n⏳ 5 HORAS\n⚙️ podrás elegir 5 colores al gusto\n🔴 rojo • 🟣 morado • ⚫ negro\n🔵 azul • 🟢 verde\n✨ consume 1 Personalizador y activa\nel rol Personalizador puede usarse escribiendo >personalizar por 5 horas\n" +
        "```"
      )
      .setColor(0x8b5cf6)
      .setImage("https://cdn.discordapp.com/attachments/1402268718360297544/1519443095379513496/E42BDE84-B055-4A1C-B788-620B7DC904AD.gif")
      .setFooter({ text: "🤖 MECHANIC SYSTEM ONLINE" });

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("shop_menu")
        .setPlaceholder("seleccionar módulo")
        .addOptions([
          { label: "Encadenar", value: "chain", emoji: "🧷" },
          { label: "Liberación", value: "release", emoji: "⛓️‍💥" },
          { label: "Renombrar", value: "rename", emoji: "✏️" },
          { label: "Random Name", value: "randomname", emoji: "🎲" },
          { label: "Inmunidad CD", value: "immunity", emoji: "🛡️" },
          { label: "Escudo", value: "shield", emoji: "🛡️" },
          { label: "Permisos Extras", value: "extras", emoji: "🔓" },
          { label: "Personalizador", value: "customizer", emoji: "🎨" },
          { label: "Cerrar", value: "close", emoji: "❌" }
        ])
    );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("tier2_shop")
        .setLabel("📀 Tienda Tier 2")
        .setStyle(ButtonStyle.Primary)
    );

    await loading.edit({ embeds: [embed], components: [menu, buttons] });
  }
});

// 🟣 INTERACTIONS SYSTEM
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const draftKey = `setup_${interaction.user.id}`;
    const draft = activeDuels.get(draftKey);

    // 🔒 VERIFICACIÓN DE PERMISOS PARA EL PANEL DE RETOS
    if (
      (interaction.isUserSelectMenu() && interaction.customId === "duel_users") ||
      (interaction.isRoleSelectMenu() && interaction.customId === "duel_roles") ||
      (interaction.isButton() && interaction.customId === "duel_setup_questions") ||
      (interaction.isModalSubmit() && interaction.customId === "duel_modal_questions")
    ) {
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const isAdmin = interaction.member.permissions.has("Administrator");
      const hasArbiterRole = interaction.member.roles.cache.has(ARBITER_ROLE);

      if (!isOwner && !isAdmin && !hasArbiterRole) {
        return interaction.reply({
          content: "❌ Solo el dueño, administradores o el Árbitro pueden interactuar con este panel.",
          ephemeral: true
        });
      }
    }

    // --- MANEJO DEL SISTEMA DE RETOS ---
    if (interaction.isUserSelectMenu() && interaction.customId === "duel_users") {
      if (!draft) return interaction.reply({ content: "❌ No tienes una configuración activa.", ephemeral: true });
      draft.users = interaction.values;
      return interaction.reply({ content: `✅ Usuarios listos: <@${draft.users[0]}> y <@${draft.users[1]}>`, ephemeral: true });
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === "duel_roles") {
      if (!draft) return interaction.reply({ content: "❌ No tienes una configuración activa.", ephemeral: true });
      draft.roles = interaction.values;
      return interaction.reply({
        content: `✅ Roles seleccionados:\n• Usuario 1 apostará: <@&${draft.roles[0]}>\n• Usuario 2 apostará: <@&${draft.roles[1]}>`,
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId === "duel_setup_questions") {
      if (!draft || draft.users.length < 2 || draft.roles.length < 2) {
        return interaction.reply({ content: "❌ Debes seleccionar 2 usuarios y 2 roles primero.", ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId("duel_modal_questions")
        .setTitle("📝 Ingresa las 3 Preguntas");

      const q1 = new TextInputBuilder().setCustomId("q1").setLabel("Pregunta 1").setStyle(TextInputStyle.Short).setRequired(true);
      const q2 = new TextInputBuilder().setCustomId("q2").setLabel("Pregunta 2").setStyle(TextInputStyle.Short).setRequired(true);
      const q3 = new TextInputBuilder().setCustomId("q3").setLabel("Pregunta 3").setStyle(TextInputStyle.Short).setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(q1),
        new ActionRowBuilder().addComponents(q2),
        new ActionRowBuilder().addComponents(q3)
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "duel_modal_questions") {
      if (!draft) return;

      draft.questions = [
        interaction.fields.getTextInputValue("q1"),
        interaction.fields.getTextInputValue("q2"),
        interaction.fields.getTextInputValue("q3")
      ];

      draft.scores[draft.users[0]] = 0;
      draft.scores[draft.users[1]] = 0;

      const duelId = `duel_${interaction.channel.id}`;
      activeDuels.set(duelId, draft);
      activeDuels.delete(draftKey);

      await interaction.reply({ content: "🔥 **¡El reto ha comenzado!**", ephemeral: true });
      sendDuelQuestion(interaction.channel, duelId);
      return;
    }

    // 1. MANEJO DE BOTONES
    if (interaction.isButton()) {
      if (interaction.customId === "tier2_shop") {
        const embed = new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle("📀 TOKEN TIER 2 SHOP")
          .setDescription("Selecciona un artículo de la Tienda Tier 2.")
          .setImage("https://cdn.discordapp.com/attachments/1402268718360297544/1530561730151841992/IMG_1992.jpg");

        const menu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("tier2_menu")
            .setPlaceholder("Selecciona un artículo")
            .addOptions([
              { label: "Token Converter", value: "converter", emoji: "📀" },
              { label: "Volver", value: "back", emoji: "⬅️" }
            ])
        );

        return interaction.update({ embeds: [embed], components: [menu] });
      }
    }

    // 2. MANEJO DE SELECT MENUS (TEXTO)
    if (interaction.isStringSelectMenu()) {
      
      // 📀 MENÚ TIER 2
      if (interaction.customId === "tier2_menu") {
        if (interaction.values[0] === "back") {
          const embed = new EmbedBuilder()
            .setTitle("🛒 ⚙️ THE MECHANIC STORE")
            .setColor(0x8b5cf6)
            .setDescription("Selecciona un artículo de la tienda principal.")
            .setImage("https://cdn.discordapp.com/attachments/1402268718360297544/1519443095379513496/E42BDE84-B055-4A1C-B788-620B7DC904AD.gif");

          const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("shop_menu")
              .setPlaceholder("Seleccionar módulo")
              .addOptions([
                { label: "Encadenar", value: "chain", emoji: "🧷" },
                { label: "Liberación", value: "release", emoji: "⛓️‍💥" },
                { label: "Renombrar", value: "rename", emoji: "✏️" },
                { label: "Random Name", value: "randomname", emoji: "🎲" },
                { label: "Inmunidad CD", value: "immunity", emoji: "🛡️" },
                { label: "Escudo", value: "shield", emoji: "🛡️" },
                { label: "Permisos Extras", value: "extras", emoji: "🔓" },
                { label: "Personalizador", value: "customizer", emoji: "🎨" },
                { label: "Cerrar", value: "close", emoji: "❌" }
              ])
          );

          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("tier2_shop")
              .setLabel("📀 Tienda Tier 2")
              .setStyle(ButtonStyle.Primary)
          );

          return interaction.update({ embeds: [embed], components: [menu, buttons] });
        }

        if (interaction.values[0] === "converter") {
          const member = interaction.member;
          if (!member.roles.cache.has(TOKEN_TIER2_ROLE)) {
            return interaction.reply({ content: "❌ Necesitas tener un Token Tier 2 para usar el Converter.", ephemeral: true });
          }

          await member.roles.remove(TOKEN_TIER2_ROLE).catch(() => {});
          let data = await Backpack.findOne({ userId: member.id });

          if (!data) {
            data = await Backpack.create({ userId: member.id, tokens: 0 });
          }

          data.tokens += 5;
          await data.save();

          return interaction.reply({
            content: `✅ Tu Token Tier 2 fue convertido correctamente.\n🎒 Recibiste **5 Tokens**.\n📀 Tokens en mochila: **${data.tokens}**`,
            ephemeral: true
          });
        }
      }

      // 🛒 MENÚ TIENDA PRINCIPAL
      if (interaction.customId === "shop_menu") {
        if (!interaction.member.roles.cache.has(TOKENS_ROLE)) {
          return interaction.reply({ content: "❌ necesitas un token para abrir la tienda.", ephemeral: true });
        }

        if (interaction.values[0] === "close") {
          return interaction.update({ content: "cerrado", embeds: [], components: [] });
        }

        return interaction.reply({
          content: "elige usuario:",
          ephemeral: true,
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId(`user_${interaction.values[0]}`)
                .setMaxValues(1)
            )
          ]
        });
      }

      // 🎨 MENÚ BOOSTER
      if (interaction.customId === "booster_menu") {
        const member = interaction.member;
        const isAdmin = member.roles.cache.has(ADMIN_ROLE);
        const hasBooster = member.roles.cache.has(BOOSTER_ROLE) || BOOSTER_COLORS.some(id => member.roles.cache.has(id));

        if (!isAdmin && !hasBooster) {
          return interaction.reply({ content: "❌ Ya no tienes permiso para usar este menú.", ephemeral: true });
        }

        const currentColors = BOOSTER_COLORS.filter(id => member.roles.cache.has(id));
        if (currentColors.length) {
          await member.roles.remove(currentColors).catch(() => {});
        }

        if (interaction.values[0] === "default") {
          return interaction.update({ content: "♻️ Has vuelto al color por defecto.", embeds: [], components: [] });
        }

        if (interaction.values[0] === "rainbow") {
          await RoleTimer.deleteMany({ guildId: member.guild.id, userId: member.id, type: "rainbow" });
          startRainbow(member);
          await addTimer(member, "rainbow", null, 10 * 60 * 1000);

          return interaction.update({ content: "🌈 Rainbow Color activado durante 10 minutos.", embeds: [], components: [] });
        }

        await member.roles.add(BOOSTER_OPTIONS[interaction.values[0]]).catch(() => {});
        return interaction.update({ content: "✅ Tu color de Booster fue actualizado.", embeds: [], components: [] });
      }

      // 🎨 MENÚ PERSONALIZADOR
      if (interaction.customId === "customizer_menu") {
        const member = interaction.member;
        if (!member.roles.cache.has(CUSTOMIZER_USED_ROLE)) {
          return interaction.reply({ content: "❌ Tu Personalizador ya no está activo.", ephemeral: true });
        }

        const currentColors = CUSTOMIZER_COLORS.filter(id => member.roles.cache.has(id));
        if (currentColors.length) {
          await member.roles.remove(currentColors).catch(() => {});
        }

        if (interaction.values[0] === "default") {
          return interaction.update({ content: "♻️ Has vuelto al color por defecto.", embeds: [], components: [] });
        }

        await member.roles.add(CUSTOMIZER_OPTIONS[interaction.values[0]]).catch(() => {});
        return interaction.update({ content: "✅ Tu color fue actualizado.", embeds: [], components: [] });
      }
    }

    // 3. MANEJO DE USER SELECT MENUS
    if (interaction.isUserSelectMenu() && !interaction.customId.startsWith("duel_")) {
      const buyer = interaction.member;

      if (!buyer.roles.cache.has(TOKENS_ROLE)) {
        return interaction.reply({ content: "❌ No tienes tokens para usar la tienda.", ephemeral: true });
      }

      const action = interaction.customId.split("_")[1];
      const targetId = interaction.values[0];
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);

      if (!target) return interaction.reply({ content: "no encontrado", ephemeral: true });

      let success = false;

      if (action === "chain") {
        await addTimer(target, "prison", PRISON_ROLE, 5 * 60000);
        success = true;
      }

      if (action === "release") {
        await target.roles.remove(PRISON_ROLE).catch(() => {});
        await RoleTimer.deleteMany({ userId: target.id, roleId: PRISON_ROLE });
        success = true;
      }

      if (action === "immunity") {
        await addTimer(target, "immunity", IMMUNITY_ROLE, 60 * 60000);
        success = true;
      }

      if (action === "shield") {
        await addTimer(target, "shield", SHIELD_ROLE, 60 * 60000);
        success = true;
      }

      if (action === "extras") {
        await addTimer(target, "extras", EXTRA_ROLE, 60 * 60000);
        success = true;
      }

      if (action === "rename") {
        const old = target.nickname || target.user.username;
        await addTimer(target, "rename", null, 60000, { oldName: old });

        if (target.manageable) {
          const modal = new ModalBuilder()
            .setCustomId(`rename_${targetId}`)
            .setTitle("renombrar usuario");

          const input = new TextInputBuilder()
            .setCustomId("new_name")
            .setLabel("nuevo nombre")
            .setStyle(TextInputStyle.Short);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return interaction.showModal(modal);
        } else {
          return interaction.reply({ content: "❌ No puedo cambiarle el nombre a este usuario.", ephemeral: true });
        }
      }

      if (action === "randomname") {
        const old = target.nickname || target.user.username;
        await addTimer(target, "randomname", null, 60000, { oldName: old });

        let i = 0;
        const interval = setInterval(async () => {
          const name = randomNames[Math.floor(Math.random() * randomNames.length)];
          if (target.manageable) {
            await target.setNickname(name).catch(() => {});
          }
          i++;
          if (i >= 3) clearInterval(interval);
        }, 20000);

        success = true;
      }

      if (action === "customizer") {
        if (!buyer.roles.cache.has(CUSTOMIZER_ROLE)) {
          return interaction.reply({ content: "❌ No tienes un Personalizador.", ephemeral: true });
        }

        await buyer.roles.remove(CUSTOMIZER_ROLE).catch(() => {});
        await addTimer(buyer, "customizer", CUSTOMIZER_USED_ROLE, 5 * 60 * 60 * 1000);

        return interaction.update({ content: "🎨 Personalizador activado durante 5 horas.", embeds: [], components: [] });
      }

      if (success) {
        const ok = await consumeToken(buyer);
        if (!ok) {
          return interaction.reply({ content: "❌ sin token", ephemeral: true });
        }

        return interaction.update({ content: "🟣 compra completada", embeds: [], components: [] });
      }
    }

    // 4. MANEJO DE MODALES
    if (interaction.isModalSubmit() && interaction.customId.startsWith("rename_")) {
      const targetId = interaction.customId.split("_")[1];
      const newName = interaction.fields.getTextInputValue("new_name");
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);

      if (target?.manageable) {
        await target.setNickname(newName).catch(() => {});
      }

      const ok = await consumeToken(interaction.member);
      return interaction.reply({
        content: ok ? "cambiado correctamente" : "❌ sin token",
        ephemeral: true
      });
    }

  } catch (error) {
    console.error("Error procesando interacción:", error);
  }
});

// 📌 EVENTO REACCIÓN CON ✅ (DETECCION DE PUNTOS PARA EL DUELO)
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== "✅") return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const message = reaction.message;
  const channel = message.channel;
  const duelId = `duel_${channel.id}`;
  const duel = activeDuels.get(duelId);

  if (!duel) return;
  if (user.id !== duel.arbiterId) return;

  const winnerOfQuestionId = message.author.id;
  if (!duel.users.includes(winnerOfQuestionId)) return;

  if (duel.timer) clearTimeout(duel.timer);

  duel.scores[winnerOfQuestionId] += 1;
  const currentP1 = duel.scores[duel.users[0]];
  const currentP2 = duel.scores[duel.users[1]];

  await channel.send(
    `✅ **¡Punto para <@${winnerOfQuestionId}>!**\n` +
    `📊 **Marcador:** <@${duel.users[0]}> [${currentP1}] - [${currentP2}] <@${duel.users[1]}>`
  );

  if (duel.scores[winnerOfQuestionId] >= 2) {
    return finishDuel(channel, duelId, winnerOfQuestionId);
  }

  duel.currentQuestion += 1;
  if (duel.currentQuestion < duel.questions.length) {
    setTimeout(() => sendDuelQuestion(channel, duelId), 2000);
  } else {
    const winnerId = currentP1 > currentP2 ? duel.users[0] : (currentP2 > currentP1 ? duel.users[1] : null);
    if (winnerId) {
      finishDuel(channel, duelId, winnerId);
    } else {
      await channel.send("🤝 **¡Empate técnico!** Nadie sumó 2 puntos. Apuestas canceladas.");
      activeDuels.delete(duelId);
    }
  }
});

// 🚀 STARTUP
client.once(Events.ClientReady, async () => {
  console.log("🤖 mechanic online");
  await checkTimers();
  setInterval(checkTimers, 60000);
});

client.login(process.env.TOKEN);
