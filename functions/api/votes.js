const VOTES_KEY = "votes:v1";
const VOTERS = new Set(["호영", "세희", "원정"]);
const VOTES = new Set(["critical", "normal", "none"]);

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export async function onRequestGet({ env }) {
  const votes = await readVotes(env);
  return json({ votes });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const votes = await readVotes(env);

  if (body.action === "clear") {
    const voter = validateVoter(body.voter);
    const ids = Array.isArray(body.ids) ? body.ids.filter(validateQuestionId) : [];
    if (!voter || !ids.length) return json({ error: "invalid_clear_request" }, 400);

    ids.forEach((id) => {
      if (!votes[id]) return;
      delete votes[id][voter];
      if (!Object.keys(votes[id]).length) delete votes[id];
    });

    await writeVotes(env, votes);
    return json({ votes });
  }

  const id = validateQuestionId(body.id) ? body.id : "";
  const voter = validateVoter(body.voter);
  const vote = body.vote === "" || body.vote === null ? "" : validateVote(body.vote);
  if (!id || !voter || vote === false) return json({ error: "invalid_vote_request" }, 400);

  votes[id] ||= {};
  if (vote) {
    votes[id][voter] = vote;
  } else {
    delete votes[id][voter];
  }
  if (!Object.keys(votes[id]).length) delete votes[id];

  await writeVotes(env, votes);
  return json({ votes });
}

async function readVotes(env) {
  if (!env.ITPE_VOTES) return {};
  const saved = await env.ITPE_VOTES.get(VOTES_KEY, "json");
  return sanitizeVotes(saved);
}

async function writeVotes(env, votes) {
  if (!env.ITPE_VOTES) throw new Error("ITPE_VOTES binding is missing");
  await env.ITPE_VOTES.put(VOTES_KEY, JSON.stringify(sanitizeVotes(votes)));
}

function sanitizeVotes(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id]) => validateQuestionId(id))
      .map(([id, byVoter]) => [
        id,
        Object.fromEntries(
          Object.entries(byVoter || {}).filter(([voter, vote]) => VOTERS.has(voter) && VOTES.has(vote)),
        ),
      ])
      .filter(([, byVoter]) => Object.keys(byVoter).length),
  );
}

function validateQuestionId(id) {
  return typeof id === "string" && /^\d{3}-[1-4]-\d{2}$/.test(id);
}

function validateVoter(voter) {
  return VOTERS.has(voter) ? voter : "";
}

function validateVote(vote) {
  return VOTES.has(vote) ? vote : false;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}
