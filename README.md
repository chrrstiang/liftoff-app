# 🏋🏼‍♂️ LiftOff

[![CI](https://github.com/chrrstiang/liftoff-app/actions/workflows/ci.yml/badge.svg)](https://github.com/chrrstiang/liftoff-app/actions/workflows/ci.yml)

**A mobile app for the powerlifting community — where coaches program, athletes log, and lifters share what they're capable of.**

Powerlifting runs on two things that live in completely different places. The training itself is a coach writing a program and an athlete reporting back on it, which today means a spreadsheet, a group chat, and a lot of screenshots. And the culture around it is almost entirely on social media — the meet recaps, the PR clips, the local scene. LiftOff is an attempt to put both in one app.

---

## ℹ️ Why I'm building it

I'm part of Northeastern Powerlifting, which put me in an unusually good position: I'm building this for a sport I compete in, surrounded by the exact people who'd use it. I got to watch the problem up close rather than guess at it — coaches juggling spreadsheets across a dozen athletes, lifters digging through months of chat history to find what they hit last block.

That's the whole idea. Centralize the practical side and the social side of powerlifting, because right now they're split across four apps and none of them were built for lifters.

---

## 🚦 Status

**Pre-release — not yet available to install.** But the coach↔athlete loop works end to end today: a coach can invite an athlete, build them a program, and message them about it; the athlete can log every set against it.

The social half doesn't exist yet. See [what's next](#-whats-next).

---

## ✅ What works today

**For coaches**
- Invite athletes by username search, and manage a roster of everyone who's accepted
- Build workouts for a specific athlete — exercises, prescribed sets, reps, RPE, and a suggested load range
- Reuse saved workout templates instead of rebuilding a session from scratch
- Message any athlete on your roster, with photo attachments for form checks

**For athletes**
- See your next session on the home screen and open straight into it
- Log actual load and RPE per set as you lift, against what was prescribed
- Accept or decline coaching invitations
- Message your coach in the same app you're training in

**For everyone**
- Sign up, create a profile, and pick your federation, division and weight class
- **Be both an athlete and a coach** — the roles are independent, and plenty of people are both
- Upload an avatar, and a full dark mode that isn't an afterthought

---

## 🔭 What's next

**The social layer** — none of this is built yet, and it's the bigger half of the idea:
- Share lifts and post meet recaps on your profile
- Communities, so a team or a gym has one place to talk
- Leaderboards, to find and scout the competition in your area

**Rounding out coaching**
- Roster-wide announcements
- Real-time messaging to replace the current polling ([design written](docs/REALTIME-MESSAGING-DESIGN.md), not built)
- Editing your profile after you create it

---

## 🛠️ Built with

**Mobile** — React Native + Expo (expo-router, NativeWind, TanStack Query)
**API** — NestJS on Node 20, Drizzle ORM
**Data** — Postgres on AWS RDS, behind the API. Supabase handles authentication and image storage
**Infra** — ECS Fargate, deployed from GitHub Actions on every push to `main`

A couple of things I'd point at if you're reading the code:

- **[`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md)** — there's no row-level security in RDS, so the API is the entire trust boundary. This is the map of who may reach what, with the enforcing code and the test pinning each rule. It came out of an audit that found six unauthenticated routes and two live bugs.
- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — how the two halves fit together, and an honest list of what's broken or unbuilt.

---

## 🚀 Running it

Setup lives in **[`docs/SETUP.md`](docs/SETUP.md)** — Node 20, Docker for the local Postgres, and a Supabase project for auth.

---

## ✍️ Author

I'm Christian Garcia, an undergraduate at Northeastern University.

- [github.com/chrrstiang](https://github.com/chrrstiang)
- [chrrstiang.com](https://www.chrrstiang.com)
- [linkedin.com/in/christiangarcia9558](https://www.linkedin.com/in/christiangarcia9558/)

## 💭 Feedback

I'll take any of it — feature ideas, bugs, design opinions. Especially from people who actually lift.

Email me at cg0712860@gmail.com and I'll be sure to check.
