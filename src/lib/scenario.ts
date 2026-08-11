import type {
  BlueQ2Draft,
  BotPrompt,
  Choice,
  ScenarioStage,
  TeamState,
} from "./game-types";

export const scenarioLength = 4;

function previousChoice(team: TeamState, stageIndex: number) {
  return team.history.find((item) => item.stageIndex === stageIndex)?.choiceId;
}

function requiredStage(
  id: string,
  title: string,
  situation: string,
  choices: Choice[],
): ScenarioStage {
  return { id, title, situation, choices, fileRequired: true };
}

export function getScenarioStage(
  team: Pick<TeamState, "color" | "history">,
  stageIndex: number,
): ScenarioStage {
  return team.color === "red"
    ? redStage(team, stageIndex)
    : blueStage(team, stageIndex);
}

export function getBotPrompt(team: TeamState): BotPrompt {
  const stage = getScenarioStage(team, team.currentStageIndex);

  if (team.color === "blue" && team.currentStageIndex === 1) {
    const blueQ2Question = getBlueQ2Question(team.blueQ2Draft ?? {});

    if (blueQ2Question) {
      return {
        stage,
        text:
          `<b>${escapeHtml(stage.title)}</b>\n\n` +
          `${escapeHtml(stage.situation)}\n\n` +
          `<b>${escapeHtml(blueQ2Question.question)}</b>`,
        choices: blueQ2Question.choices,
        mode: "blue-q2-question",
      };
    }
  }

  return {
    stage,
    text:
      `<b>${escapeHtml(stage.title)}</b>\n\n` +
      `${escapeHtml(stage.situation)}\n\n` +
      "Выберите решение команды:",
    choices: stage.choices,
    mode: "stage-choice",
  };
}

export function getChoiceLabel(team: TeamState, choiceId: string) {
  const stage = getScenarioStage(team, team.currentStageIndex);
  return stage.choices.find((choice) => choice.id === choiceId)?.label;
}

export function getBlueQ2ChoiceId(draft: Required<BlueQ2Draft>) {
  return `${draft.hire ? "hire" : "nohire"}-${draft.pr ? "pr" : "nopr"}-${draft.bonus ? "bonus" : "nobonus"}`;
}

export function getBlueQ2ChoiceLabel(draft: Required<BlueQ2Draft>) {
  return `Найм: ${draft.hire ? "да" : "нет"}; PR: ${draft.pr ? "да" : "нет"}; аванс бонуса: ${draft.bonus ? "да" : "нет"}`;
}

export function applyBlueQ2Answer(
  draft: BlueQ2Draft,
  part: string,
  value: string,
) {
  const boolValue = value === "yes";

  if (part === "hire") {
    return { ...draft, hire: boolValue };
  }

  if (part === "pr") {
    return { ...draft, pr: boolValue };
  }

  if (part === "bonus") {
    return { ...draft, bonus: boolValue };
  }

  return draft;
}

export function isCompleteBlueQ2Draft(
  draft: BlueQ2Draft,
): draft is Required<BlueQ2Draft> {
  return (
    typeof draft.hire === "boolean" &&
    typeof draft.pr === "boolean" &&
    typeof draft.bonus === "boolean"
  );
}

function getBlueQ2Question(draft: BlueQ2Draft) {
  if (typeof draft.hire !== "boolean") {
    return {
      part: "hire",
      question: "Нанимаем ещё 2 СК или нет, так как вся текущая команда занята на проектах?",
      choices: [
        { id: "blueq2:hire:yes", label: "Да" },
        { id: "blueq2:hire:no", label: "Нет" },
      ],
    };
  }

  if (typeof draft.pr !== "boolean") {
    return {
      part: "pr",
      question: "Проводим PR-мероприятие про старт проекта за свой счёт на 15 млн рублей?",
      choices: [
        { id: "blueq2:pr:yes", label: "Да" },
        { id: "blueq2:pr:no", label: "Нет" },
      ],
    };
  }

  if (typeof draft.bonus !== "boolean") {
    return {
      part: "bonus",
      question: "Выплачиваем продавцу 30% бонуса авансом для оплаты ипотеки?",
      choices: [
        { id: "blueq2:bonus:yes", label: "Да" },
        { id: "blueq2:bonus:no", label: "Нет" },
      ],
    };
  }

  return null;
}

function redStage(
  team: Pick<TeamState, "color" | "history">,
  stageIndex: number,
): ScenarioStage {
  if (stageIndex === 0) {
    return requiredStage(
      "red-q1-yakor-modernization",
      "Этап 1. Начало Q1 (апрель)",
      "Клиент «Якорь» предлагает дополнительный проект по модернизации со скидкой 10% относительно текущих ставок. Выручка - 2,7 млн рублей. Через месяц заказчик требует показать команду и обещает начать проект сразу после знакомства с ней.",
      [
        {
          id: "urgent-hire",
          label: "Срочно нанять 2 старших консультантов (+10% к зарплате)",
        },
        {
          id: "use-contractors",
          label: "Выполнить проект подрядчиками (маржинальность 20%)",
        },
      ],
    );
  }

  if (stageIndex === 1) {
    const q1Choice = previousChoice(team as TeamState, 0);
    const q1Consequence =
      q1Choice === "urgent-hire"
        ? "В Q1 вы наняли двух старших консультантов: при старте сейчас они получат коммерческую загрузку, а при переносе на Q3 будут простаивать."
        : "В Q1 вы выбрали подрядчиков: при старте сейчас они потребуют акты в текущем календарном году раньше доходного акта, а при ожидании до Q3 их маржинальность упадёт до 10%.";

    return requiredStage(
      "red-q2-staffing-and-yakor-start",
      "Этап 2. Начало Q2 (июль)",
      `Две старшие консультантки уходят в декрет. Одновременно модернизация «Якоря» не началась: договор получится подписать только в январе, тогда же придёт выручка, а завершить работы нужно не позднее января. Решите, как заменить сотрудниц и когда начать модернизацию. ${q1Consequence}`,
      [
        {
          id: "hire-now",
          label: "Нанять 2 СК через месяц; начать модернизацию сейчас",
        },
        {
          id: "hire-q3",
          label: "Нанять 2 СК через месяц; начать модернизацию в Q3",
        },
        {
          id: "gamma-contractors-now",
          label: "Передать «Гамму» подрядчикам; начать модернизацию сейчас",
        },
        {
          id: "gamma-contractors-q3",
          label: "Передать «Гамму» подрядчикам; начать модернизацию в Q3",
        },
      ],
    );
  }

  if (stageIndex === 2) {
    return requiredStage(
      "red-q3-profit-target",
      "Этап 3. Начало Q3 (октябрь)",
      "«Якорь» готов заактировать модернизацию в январе, но категорически не повышает ставки за регулярную поддержку, хотя повышение было заложено в бюджет. С Q4 зарплаты сотрудников нужно повысить на 10%; остальные клиенты согласны повысить ставки только на 5%. Будете что-то менять в Прогнозе года, чтобы выполнить цели Бюджета?",
      [
        { id: "keep-profit-target", label: "Да" },
        { id: "revise-profit-target", label: "Нет" },
      ],
    );
  }

  if (stageIndex === 3) {
    const hiredInQ2 = previousChoice(team as TeamState, 1)?.startsWith("hire-") ?? false;
    const capacityConsequence = hiredInQ2
      ? "Так как в Q2 вы наняли двух старших консультантов, в Q4 у команды есть ресурсы, но их утилизация достигнет 100%."
      : "Так как в Q2 вы не наняли двух старших консультантов, для нового проекта потребуется срочно нанять одного консультанта с окладом на 10% выше обычного.";

    return requiredStage(
      "red-q3-new-client",
      "Этап 4. Конец Q3 (декабрь)",
      `Новый клиент готов перейти к вам от конкурента с Q4, но просит скидку 10% относительно ваших ставок. Выручка - 2 млн рублей в квартал; привлечь подрядчика нельзя. ${capacityConsequence}`,
      [
        { id: "give-discount", label: "Дать скидку и взять клиента" },
        {
          id: "refuse-discount",
          label: "Не давать скидку и принять риск потери клиента",
        },
      ],
    );
  }

  throw new Error(`Неизвестный этап красного сценария: ${stageIndex}`);
}

function blueQ2Choices(): Choice[] {
  const choices: Choice[] = [];

  for (const hire of [true, false]) {
    for (const pr of [true, false]) {
      for (const bonus of [true, false]) {
        choices.push({
          id: getBlueQ2ChoiceId({ hire, pr, bonus }),
          label: getBlueQ2ChoiceLabel({ hire, pr, bonus }),
        });
      }
    }
  }

  return choices;
}

function blueStage(
  team: Pick<TeamState, "color" | "history">,
  stageIndex: number,
): ScenarioStage {
  if (stageIndex === 0) {
    return requiredStage(
      "blue-q1-shahta-discount",
      "Этап 1. Начало Q1 (апрель)",
      "Клиент «Шахта» пришёл по рекомендации и просит скидку 10%. Утилизация команды не повысится. Проект рассчитан на Q1 и Q2.",
      [
        {
          id: "discount-start",
          label: "Дать скидку и начать сейчас (выручка ниже на 10%)",
        },
        {
          id: "hold-rate",
          label: "Не давать скидку и принять риск долгих переговоров",
        },
      ],
    );
  }

  if (stageIndex === 1) {
    const shahtaOutcome =
      previousChoice(team as TeamState, 0) === "hold-rate"
        ? "«Шахта» согласилась на ваши условия без скидки."
        : "Проект «Шахты» продолжается с предоставленной скидкой.";

    return requiredStage(
      "blue-q2-vyshka-package",
      "Этап 2. Начало Q2 (июль)",
      `${shahtaOutcome} Вы выиграли проект в клиенте «Вышка» по новой для вас теме со скидкой 10%: выручка 56 млн рублей - 25 млн в Q3 и 31 млн в Q4. Производственный персонал загружен на 90% до конца года. Нужно последовательно принять три решения.`,
      blueQ2Choices(),
    );
  }

  if (stageIndex === 2) {
    const q2Choice = previousChoice(team as TeamState, 1) ?? "";
    const hadPr = q2Choice.includes("-pr-");
    const paidBonus = q2Choice.endsWith("-bonus");
    const stopLabel = hadPr
      ? "Остановить исходный план и согласовать с «Вышкой» сокращение рамок"
      : `Остановить проект: выручка обнулится, продавец ${paidBonus ? "останется" : "уволится"}`;

    return requiredStage(
      "blue-q3-vyshka-crisis",
      "Этап 3. Начало Q3 (октябрь)",
      "Руководитель проекта «Вышки» уверен, что трудоёмкость и сроки недооценены в два раза. Прогнозная выручка сдвигается на квартал вправо - в Q4 и новый финансовый год, а заказчик не хочет расширять бюджет. Если продолжить за свой счёт, сроки и трудоёмкость затем увеличатся ещё на 30% к новой оценке, и актов в текущем финансовом году не будет.",
      [
        { id: "stop-project", label: stopLabel },
        {
          id: "continue-own-cost",
          label: "Продолжить, взяв перерасход бюджета на себя",
        },
      ],
    );
  }

  if (stageIndex === 3) {
    const q2Choice = previousChoice(team as TeamState, 1) ?? "";
    const q3Choice = previousChoice(team as TeamState, 2);
    const hired = q2Choice.startsWith("hire-");
    const hadPr = q2Choice.includes("-pr-");
    const paidBonus = q2Choice.endsWith("-bonus");
    const stopped = q3Choice === "stop-project";
    const sellerStayed = !stopped || hadPr || paidBonus;
    const lostVyshka = stopped && !hadPr;
    const canTakePtitsa = sellerStayed && ((hired && !stopped) || lostVyshka);

    let consequence: string;
    if (!sellerStayed) {
      consequence =
        "Проект «Вышки» остановлен, его выручка обнулена, а продавец ушёл - нового клиента «Птица» команда не получает.";
    } else if (canTakePtitsa) {
      consequence =
        "Продавец остался и привёл клиента «Птица» на типовой проект в Q4. Команда может добавить 7 млн рублей выручки: либо были наняты люди и «Вышка» продолжается, либо «Вышка» потеряна и ресурсы освободились.";
    } else if (hired && stopped && hadPr) {
      consequence =
        "После PR-мероприятия «Вышка» согласилась сократить рамки проекта, продавец остался. Зафиксируйте последствия принятых решений в прогнозе.";
    } else {
      consequence =
        "Продавец остался и привёл клиента «Птица», но при продолжающейся «Вышке» без найма новых людей команда не может взять этот проект. Срочный найм и подряд недоступны.";
    }

    return requiredStage(
      "blue-q3-ptitsa-consequences",
      "Этап 4. Конец Q3",
      consequence,
      [
        {
          id: "record-consequences",
          label: "Зафиксировать последствия в финансовом прогнозе",
        },
      ],
    );
  }

  throw new Error(`Неизвестный этап синего сценария: ${stageIndex}`);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
