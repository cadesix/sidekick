### Onboarding

- Collect context about user (name, gender, age)
- Choose goals
- Personality test
- Get Sidekick, choose color

### Onboarding Chat

*After onboarding, we drop the user in a guided chat that helps them orient their goals*

- Sidekick intro
- Give options for each goal’s action items
    - How do you want to get fit? [Go to the gym] [Run] [Play a sport]
    - How many times per week? OR daily check-in criteria (ie sleep time, # steps, screentime)
- Choose reminder cadence (default daily)
- Push notif prompt

### Goals

*Each high-level goal has action items (below are just brainstormed ideas we can flesh out more)*

- Get Fit
    - Go to the gym
    - Run
    - Play a sport
- Sleep Better
    - Sleep by a certain time
    - Wake up at a certain time
- Stop procrastinating
    - Limit screen time (I think API is hard to get access to)
    - Complete work by X time
- Improve social skills
    - unsure how we’d track this
- Manage Stress
    - Meditate
    - Breathwork
- Read More
    pages or minutes per day
- Be more productive
    - unsure how we’d track this

### Daily Check-In

Each day you get a message from your sidekick. The message is variable and should feel inviting / fun (like a friend texting you rather than your mom asking if you did your homework). Ideally it can also pull in context without feeling creepy

- it’s soo hot in the city today, did you manage to get a run in?
- happy saturday! how’d you sleep?
- how’d your first day at the new job go yesterday?

Sidekick will lead the chat into asking about your goals, without feeling pushy or judgmental. It infers whether or not you hit your goals through the conversation, then calls a tool to mark your daily list accordingly

### Gamification

We can generate an infinite number of unlockable assets like hats, shoes, skins, environments, etc. and use them to incentivize engagement

- Daily streaks with tangible rewards given on a curve (easier to get rewards in beginning)
- Daily spinner reward / loot box (can give t an item)

Potentially gift the user money as a cheap UA mechanic / for virality (maybe ad network will help subsidize this if we pitch it as viral feature?)

### Personality

- Knows your interests and can proactively bring up important events / milestones
- Up-to-date on pop culture and trends, and will proactively mention based on your demonstrated interests (music, clothing, favorite brands); great pitch for advertisers

### Ideas

- Live activities in place of push notifs

### Prompts

```jsx
you are [sidekick.name]

you're a friend meant to keep the user accountable toward their goals - but without being pushy, without nagging or feeling like an authority figure. conversation should always feel more friendly, engaging, and interesting. goals are weaved in naturally.

you speak like a peer and a friend in the language of ~25 year old, internet-native americans
- no capital letters
- occassional chat slang when appropriate
```
