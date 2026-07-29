import {event_types, getCharacterCardFields, main_api, messageFormatting} from '../../../../script.js';
import {
    as_message,
    as_message_role,
    count_tokens, count_tokens_async,
    get_data,
    get_message_div,
    get_message_prompts,
    get_preset,
    log,
    set_data,
} from './utils.js';
import {
    auto_load_profile,
    bind_function,
    bind_setting,
    delete_profile,
    get_settings,
    initialize_settings,
    load_profile,
    new_profile,
    refresh_settings,
    rename_profile,
    render_settings_menu,
    save_profile,
    set_character_enabled_button_states,
    show_settings_prompt,
    show_settings_prompt_pre,
    toggle_character_profile,
    toggle_chat_profile,
} from './settings.js';
import {power_user} from '../../../power-user.js';
import {formatInstructModeChat} from '../../../instruct-mode.js';
import {t} from '../../../i18n.js';
import {get_connection_profile} from './connections.js';
import {getContext, renderExtensionTemplateAsync} from '../../../extensions.js';
import {EXTENSION_PATH, MODULE_NAME} from './conf.js';
import {Popup, POPUP_TYPE} from '../../../popup.js';
import {getWorldInfoPrompt} from "/scripts/world-info.js";

const context = SillyTavern.getContext();
const show_button_class = `${MODULE_NAME}_show_button`
const delete_button_class = `${MODULE_NAME}_delete_button`
const advanced_button_class = `${MODULE_NAME}_advanced_button`

function is_chat_completion() {
    return main_api === 'openai';
}

function get_review_prompt() {
    let review_prompt = get_settings("review_prompt");
    if (!is_chat_completion() && power_user.instruct.enabled) {
        // noinspection JSCheckFunctionSignatures
        review_prompt = formatInstructModeChat("", review_prompt, false, true);
    }

    if (is_chat_completion()) {
        return [{ role: "user", content: review_prompt }];
    }
    return review_prompt;
}

function get_review_prompt_pre() {
    let review_prompt = get_settings("review_prompt_pre");
    if (!is_chat_completion() && power_user.instruct.enabled) {
        // noinspection JSCheckFunctionSignatures
        review_prompt = formatInstructModeChat("", review_prompt, false, true);
    }
    if (is_chat_completion()) {
        return [{ role: "system", content: review_prompt }];
    }
    return review_prompt;
}

function initialize_request_metadata() {
    const connection_id = get_connection_profile();
    const connection = context.ConnectionManagerRequestService.getProfile(connection_id);
    const preset = get_preset(connection, context);

    return {
        cId: connection_id,
        connection: connection,
        preset: preset,
        num_predict: preset.genamt,
        total_size: preset.max_length,
        max_context_size: preset.max_length - preset.genamt
    };
}

class PromptEngineeringChatComplete {
    constructor(mId, rawPrompt, last_chat_message, metadata, advancedInfo) {
        this.mId = mId;
        this.prompt = get_review_prompt();
        this.prompt_pre = get_review_prompt_pre();
        this.rawPrompt = rawPrompt; // Array of {role, content}
        this.last_chat_message = last_chat_message;
        this.metadata = metadata;
        this.advancedInfo = advancedInfo;
    }

    async generate_advanced_prompt(extra_tokens) {
        let totalSize = 0;
        let queries = [];
        const context = SillyTavern.getContext();
        if (this.advancedInfo.prompt) {
            this.prompt = [ as_message_role(this.advancedInfo.prompt, "system") ];
        }

        let {
            description,
            personality,
            persona,
            scenario,
            mesExamples,
            system,
            jailbreak,
            charDepthQuery,
            creatorNotes,
        } = getCharacterCardFields();

        if (jailbreak) {
            queries.push({
                content: jailbreak,
                role: "system",
            })
        }

        if (this.prompt_pre) {
            queries = [...queries, ...this.prompt_pre];
        }

        if (this.advancedInfo.scenario) {
            if (system)
                queries.push({
                    content: scenario,
                    role: "system",
                });
            if (scenario)
                queries.push({
                    content: scenario,
                    role: "system",
                });
        }

        if (this.advancedInfo.persona) {
            if (persona)
                queries.push({
                    content: persona,
                    role: "system",
                });
        }

        if (this.advancedInfo.characters) {
            if (description)
                queries.push({
                    content: description,
                    role: "system",
                });
            if (personality)
                queries.push({
                    content: personality,
                    role: "system",
                });
            if (mesExamples)
                queries.push({
                    content: mesExamples,
                    role: "system",
                });
        }

        totalSize = await count_tokens_async(queries) + await count_tokens_async(this.prompt);
        let testSize = totalSize;
        const chat = [...context.chat, this.last_chat_message];

        if (this.advancedInfo.worldinfo) {
            const testMessages = [];
            let tBuf = "";

            for (let i=chat.length-1; i>=0; i--) {
                const m = chat[i];
                if (m && m.mes) {
                    const text = m.mes;
                    testMessages.push({
                        content: text,
                        role: "system"
                    });
                    testSize = await count_tokens_async(testMessages) + totalSize;
                    if (testSize > this.advancedInfo.tokenLimit) {
                        break;
                    }

                    tBuf += "\n\n" + m.mes;
                }
            }

            // we have buffer, now we test worldinfo and get preliminary size
            const globalScanData = {
                personaDescription: persona,
                characterDescription: description,
                characterPersonality: personality,
                characterDepthQuery: charDepthQuery,
                scenario: scenario,
                creatorNotes: creatorNotes,
                trigger: this.advancedInfo.wiTrigger,
            };
            const this_max_context = this.advancedInfo.tokenLimit;
            const {
                worldInfoString,
                worldInfoBefore,
                worldInfoAfter,
                worldInfoExamples,
                worldInfoDepth,
                outletEntries
            } = await getWorldInfoPrompt(tBuf ? [ tBuf ] : [ ], this_max_context, false, globalScanData);

            const worldInfoTest = [];
            if (worldInfoBefore) {
                worldInfoTest.push({
                    content: worldInfoBefore,
                    role: "system"
                });
            }
            if (worldInfoAfter) {
                worldInfoTest.push({
                    content: worldInfoAfter,
                    role: "system"
                });
            }

            testSize = totalSize + await count_tokens_async(worldInfoTest);

            const messages = [];
            let mBuf = "";
            for (let i=this.mId; i>=0; i--) {
                const m = chat[i];
                if (m && m.mes) {
                    const text = m.mes;
                    messages.push({
                        content: text,
                        role: "system"
                    });
                    testSize = await count_tokens_async(messages) + totalSize + await count_tokens_async(worldInfoTest);
                    if (testSize > this.advancedInfo.tokenLimit) {
                        break;
                    }

                    mBuf = m.mes + "\n\n" + mBuf;
                }
            }

            // generate final worldinfo
            const globalScanDataR = {
                personaDescription: persona,
                characterDescription: description,
                characterPersonality: personality,
                characterDepthQuery: charDepthQuery,
                scenario: scenario,
                creatorNotes: creatorNotes,
                trigger: this.advancedInfo.wiTrigger,
            };
            let this_max_contextR = this.advancedInfo.tokenLimit;
            const wi = await getWorldInfoPrompt(mBuf ? [ mBuf ] : [ ], this_max_contextR, false, globalScanDataR);

            if (wi.worldInfoBefore) {
                queries.push({
                    content: wi.worldInfoBefore,
                    role: "system"
                });
            }
            if (wi.worldInfoAfter) {
                queries.push({
                    content: wi.worldInfoAfter,
                    role: "system"
                });
            }

            queries.push({
                content: mBuf,
                role: "assistant",
            });
        } else {
            // ignore test messages they are not needed
            const messages = [];
            let mBuf = "";
            for (let i=this.mId; i>=0; i--) {
                const m = chat[i];
                if (m && m.mes) {
                    const text = m.mes;
                    messages.push({
                        content: text,
                        role: "system"
                    });
                    testSize = await count_tokens_async(messages) + totalSize;
                    if (testSize > this.advancedInfo.tokenLimit) {
                        break;
                    }

                    mBuf = m.mes + "\n\n" + mBuf;
                }
            }
            queries.push({
                content: mBuf,
                role: "assistant",
            });
        }

        if (this.prompt) {
            queries = [...queries, ...this.prompt];
        }

        return queries;
    }

    // 1. Turned method into an async function
    async generate_review_prompt(promptData, extra_tokens) {
        if (this.advancedInfo && !this.advancedInfo.usePromptInfo) {
            return await this.generate_advanced_prompt(extra_tokens);
        }

        // Safe check for both primitive strings and String objects
        if (typeof this.rawPrompt === 'string' || this.rawPrompt instanceof String) {
            this.rawPrompt = [this.rawPrompt];
        }

        let trimmedRaw = [];
        const removeOnce = {};

        // Keep your original filtering logic intact first
        this.rawPrompt.forEach(m => {
            if (get_settings("remove_instruction") && !removeOnce["instruction"]) {
                if (m.content === promptData.instruction) {
                    removeOnce["instruction"] = true;
                    return;
                }
            }
            if (get_settings("remove_user") && !removeOnce["user"]) {
                if (m.content === promptData.userPersona) {
                    removeOnce["user"] = true;
                    return;
                }
            }
            if (get_settings("remove_character") && !removeOnce["character"]) {
                if (m.content === promptData.charDescription) {
                    removeOnce["character"] = true;
                    return;
                }
            }
            if (get_settings("remove_world_info") && !removeOnce["world_info"]) {
                if (m.content === promptData.worldInfoString) {
                    removeOnce["world_info"] = true;
                    return;
                }
            }
            trimmedRaw.push(m);
        });

        // 2. Inline helper to process text and safely extract the tuple value
        const processText = async (text) => {
            if (!window.enerccio_compat?.textProcessor) return text;

            const result = await window.enerccio_compat.textProcessor(text, { imprint: false });
            return Array.isArray(result) ? result[0] : text;
        };

        // 3. Process all strings concurrently using Promise.all to optimize performance
        const processedPromptPre = await Promise.all(this.prompt_pre.map(async m => ({
            ...m,
            content: await processText(m.content)
        })));

        const processedPrompt = await Promise.all(this.prompt.map(async m => ({
            ...m,
            content: await processText(m.content)
        })));

        const processedTrimmedRaw = await Promise.all(trimmedRaw.map(async m => ({
            ...m,
            content: await processText(m.content)
        })));

        const processedLastMesText = await processText(this.last_chat_message.mes);

        // 4. Calculate tokens using the newly processed content
        let tokenCountPrompt = processedPrompt.reduce((acc, m) => acc + count_tokens(m.content), 0);
        tokenCountPrompt += processedPromptPre.reduce((acc, m) => acc + count_tokens(m.content), 0);
        const lastMessageTokenCount = count_tokens(processedLastMesText);

        const max_size = this.metadata.max_context_size;

        // Remove messages from the start of processedTrimmedRaw until it fits the token limit
        while (processedTrimmedRaw.length > 0) {
            let currentTokens = processedTrimmedRaw.reduce((acc, m) => acc + count_tokens(m.content), 0);
            if (currentTokens + tokenCountPrompt + extra_tokens + lastMessageTokenCount <= max_size) {
                break;
            }
            processedTrimmedRaw.shift();
        }

        // 5. Assemble and return the fully processed prompt array
        return [
            ...processedPromptPre,
            ...processedTrimmedRaw,
            as_message_role(processedLastMesText, this.last_chat_message.is_user ? "user" : "assistant"),
            ...processedPrompt
        ];
    }
}

class PromptEngineeringTextComplete {

    constructor(mId, current_message, metadata) {
        this.mId = mId;
        this.prompt = get_review_prompt();
        this.prompt_pre = get_review_prompt_pre();
        this.original = current_message.mes;
        this.metadata = metadata;
        this.last_message = -1;
    }

    _find_first_message() {
        if (context.chat.length === 0)
            return -1;
        let ids_to_search = [];
        for (let i=0; i<this.mId; i++) {
            let m = context.chat[i];
            if (!m.is_system)
                ids_to_search.push(i);
        }

        let last_message_id = null;
        while (true) {
            let message_id;
            if (ids_to_search.length === 1) {
                message_id = ids_to_search[0];
            } else if (ids_to_search.length === 2) {
                message_id = ids_to_search[0];
                let message_id2 = ids_to_search[0];
                let m = context.chat[message_id];
                let m2 = context.chat[message_id2];
                if (this.text.includes(m.mes)) {
                    last_message_id = message_id;
                } else if (this.text.includes(m2.mes)) {
                    last_message_id = message_id2;
                }
                break;
            } else {
                message_id = ids_to_search[Math.floor(ids_to_search.length / 2)];
            }

            let m = context.chat[message_id];
            if (this.text.includes(m.mes)) {
                last_message_id = message_id;
                if (ids_to_search.length === 1) {
                    break;
                }
                let copy = [];
                for (let i=0; i<Math.floor(ids_to_search.length/2); i++) {
                    copy.push(ids_to_search[i]);
                }
                ids_to_search = copy;
            } else {
                if (ids_to_search.length === 1) {
                    break;
                }

                let copy = [];
                for (let i=Math.floor(ids_to_search.length/2+1); i<ids_to_search.length; i++) {
                    copy.push(ids_to_search[i]);
                }
                ids_to_search = copy;
            }
        }

        return last_message_id;
    }

    _shift_messages() {
        while (this.last_message < context.chat.length) {
            let message = context.chat[this.last_message];
            if (message.is_system) {
                // ignore system messages - go for another message - system messages are not in prompt
                this.last_message = this.last_message + 1;
                continue;
            }
            let mesBufPos = this.text.indexOf(message.mes)
            if (mesBufPos >= 0) {
                // trim everything until index of the message
                const ctokens = this.text_tokens;
                this.text = this.text.substring(mesBufPos, this.text.length);

                this.text = this.text.replace(message.mes, "")
                // we lowered the amount of tokens actual messages now occupy
                this.text_tokens = count_tokens(this.text);
                // shift last included message to reflect the change
                this.last_message = this.last_message + 1;

                return ctokens - this.text_tokens;
            }
            // message not in the context, go for more messages
            this.last_message = this.last_message + 1;
        }
        // we failed to remove anything
        return -1;
    }

    _split() {
        let m = context.chat[this.last_message];
        const ix = this.text.indexOf(m.mes);
        this.pretext = this.text.substring(0, ix);
        this.pretext_tokens = count_tokens(this.pretext);
        this.text = this.text.substring(ix);
    }

    async generate_review_prompt(promptData, extra_tokens) {
        if (get_settings("remove_instruction")) {
            this.original = this.original.replace(promptData.instruction, "")
        }
        if (get_settings("remove_user")) {
            this.original = this.original.replace(promptData.userPersona, "")
        }
        if (get_settings("remove_character")) {
            this.original = this.original.replace(promptData.charDescription, "")
        }
        if (get_settings("remove_world_info")) {
            this.original = this.original.replace(promptData.worldInfoString, "")
        }

        this.text = this.original;
        this.last_message = this._find_first_message();
        if (this.last_message < 0) {
            // no optimizations can be done in this edge case?
            return this.prompt_pre + this.original + this.prompt;
        }

        this._split();

        let token_count_prompt = count_tokens(this.prompt);
        token_count_prompt += count_tokens(this.prompt_pre);
        this.text_tokens = count_tokens(this.text);

        const max_size = this.metadata.max_context_size;
        while (this.pretext_tokens + this.text_tokens + token_count_prompt + extra_tokens > max_size) {
            if (this._shift_messages() < 0) {
                return this.prompt_pre + this.original + this.prompt;
            }
        }

        const textData =  this.prompt_pre + this.pretext + this.text + this.prompt;
        return await window.enerccio_compat?.textProcessor(textData) || textData;
    }

}


let asyncGenerator = null;
let abort = null;

class ReviewWindow {

    constructor(mId, messageBlock, sc, left, right, counter) {
        this.mId = mId;
        this.review = null;
        this.reviewWithSwipes = null;
        this.messageBlock = messageBlock;
        this.sc = sc;
        this.left = left;
        this.right = right;
        this.counter = counter;
        this.displaying = 0;
        this.editing = false;
        this.needs_generating = false;
        this.metadata = initialize_request_metadata();

        this.sc.onclick = async event => {
            if (this.editing)
                return;
            await this.stop_or_continue();
        };

        this.messageBlock.addEventListener('click', () => {
            if (this.is_generating())
                return;
            this.set_to_edit();
            this.update_state();
        });
    }

    save() {
        set_data(context.chat[this.mId], "review", this.reviewWithSwipes);
    }

    get_review() {
        if (this.review) {
            return this.review;
        }
        this.reviewWithSwipes = get_data(context.chat[this.mId], "review");
        if (this.reviewWithSwipes == null) {
            this.needs_generating = true;
            this.review = {
                reviews: [{
                    text: "",
                    previous: "",
                    metadata: {
                        reasoning: "",
                    }
                }],
                current: 0
            };
            this.reviewWithSwipes = [];
            let swipe = context.chat[this.mId].swipe_id;
            if (swipe) {
                this.reviewWithSwipes[swipe] = this.review;
            } else {
                this.reviewWithSwipes[0] = this.review;
            }
            this.save();
        } else {
            let swipe = context.chat[this.mId].swipe_id;
            if (!swipe) {
                swipe = 0;
            }
            if (this.reviewWithSwipes[swipe]) {
                this.review = this.reviewWithSwipes[swipe];
            } else {
                this.needs_generating = true;
                this.review = {
                    reviews: [{
                        text: "",
                        previous: "",
                        metadata: {
                            reasoning: "",
                        }
                    }],
                    current: 0
                };
                this.reviewWithSwipes[swipe] = this.review;
                this.save();
            }
        }

        return this.review;
    }

    set_to_edit() {
        this.editing = true;
        const $details = $(this.messageBlock).closest('.mes_block').find('.mes_reasoning_details');
        $details.hide();

        // noinspection JSUnresolvedReference
        let $textarea = $(`<textarea class="" rows="1"></textarea>`);
        this.messageBlock.hidden = true;
        this.messageBlock.after($textarea[0]);
        $textarea.focus();  // focus on the textarea
        // noinspection JSUnresolvedReference
        $textarea.val(this.review.reviews[this.displaying].text);  // set the textarea value to the memory text (this is done after focus to keep the cursor at the end)
        // noinspection JSUnresolvedReference
        $textarea.height($(`#reviewChat`).height() - 40);  // set the height of the textarea to fit the text

        const confirm_edit = () => {
            // noinspection JSUnresolvedReference
            this.review.reviews[this.displaying].text = $textarea.val();
            $textarea.remove();  // remove the textarea
            this.messageBlock.hidden = false;  // show the memory div
            this.editing = false;
            if (this.review.reviews[this.displaying]?.metadata?.reasoning) {
                $details.show();
            }

            this.save();
            this.display_review();
        }

        // save when the textarea loses focus, or when enter is pressed
        $textarea.on('blur', confirm_edit);
    }

    get_message_or_swipe() {
        const message = context.chat[this.mId];
        if (message.swipe_id) {
            return {
                mes: message.swipes[message.swipe_id],
                is_user: message.is_user
            };
        } else {
            return message;
        }
    }

    display_review() {
        let text = this.get_review().reviews[this.displaying].text;
        text = messageFormatting(text, "", false, false, -1);
        this.messageBlock.innerHTML = `${text}`;
        this.update_state();

        let reasoning = this.get_review().reviews[this.displaying]?.metadata?.reasoning;
        const $details = $(this.messageBlock).closest('.mes_block').find('.mes_reasoning_details');
        const $reasoningContent = $details.find('.mes_reasoning');
        const $reasoningHeader = $details.find('.mes_reasoning_header');

        if (reasoning) {
            $details.show();
            $reasoningContent.html(messageFormatting(reasoning, "", false, false, -1));

            const reasoningTime = this.get_review().reviews[this.displaying]?.metadata?.reasoningTime;
            const reasoningDone = this.get_review().reviews[this.displaying]?.metadata?.reasoningDone;
            if (reasoningTime) {
                const seconds = (reasoningTime / 1000).toFixed(1);
                if (reasoningDone)
                    $reasoningHeader.text(`Thought for ${seconds} seconds`);
                else
                    $reasoningHeader.text(`Thinking for ${seconds} seconds`);
            }
        } else {
            $details.hide();
        }
    }

    scroll_to_bottom() {
        this.messageBlock.parentElement.parentElement.parentElement.scrollTop = this.messageBlock.parentElement.parentElement.parentElement.scrollHeight;
    }

    update_state() {
        if (this.is_generating()) {
            this.sc.title = "Stops the generation of review";
            this.sc.innerHTML = "Stop generating";
            this.left.onclick = undefined;
            this.right.onclick = undefined;
        } else {
            if (!is_chat_completion()) {
                this.sc.title = "Continues generating more";
                this.sc.innerHTML = "Continue generating";
            } else {
                this.sc.title = "Continue is disabled in Chat Complete";
                this.sc.innerHTML = "Disabled";
            }
            if (this.get_review().reviews.length > 1 && this.displaying > 0) {
                this.left.onclick = () => {
                    if (this.editing)
                        return;
                    this.shift_left();
                }
            }
            this.right.onclick = async () => {
                if (this.editing)
                    return;
                if (this.displaying === this.get_review().reviews.length-1) {
                    // generate new
                    this.get_review().reviews.push({
                        text: "",
                        previous: "",
                        metadata: {
                            reasoning: "",
                        }
                    });
                    this.advancedInfo = this.get_review().reviews[this.displaying].metadata.advancedInfo;
                    this.get_review().current += 1;
                    this.displaying += 1;
                    this.save();
                    await this.generate_review(this.mId, false);
                } else {
                    this.shift_right();
                }
            };
        }
        this.counter.innerHTML = `${this.displaying + 1} / ${this.get_review().reviews.length}`;
    }

    is_generating() {
        return abort != null && !abort.signal.aborted;
    }

    shift_left() {
        this.displaying = this.displaying - 1;
        this.get_review().current = this.get_review().current - 1;
        this.save();
        this.display_review();
    }

    shift_right() {
        this.displaying = this.displaying + 1;
        this.get_review().current = this.get_review().current + 1;
        this.save();
        this.display_review();
    }

    async stop_or_continue() {
        if (this.is_generating()) {
            abort.abort("userStopped");
            abort = null;
            this.display_review()
            asyncGenerator = null;
        } else {
            if (is_chat_completion())
                return;
            await this.generate_review(this.mId, true);
        }
    }

    async generate_review(mId, continue_generating) {
        if (continue_generating) {
            this.get_review().reviews[this.displaying].previous = this.get_review().reviews[this.displaying].text;
        }

        if (abort != null) {
            throw "AbortSet";
        }

        if (this.advancedInfo) {
            this.review.reviews[this.displaying].metadata.advancedInfo = this.advancedInfo;
        }

        abort = new AbortController();
        this.display_review();

        const profile = get_connection_profile();
        const messagePrompt = get_message_prompts(mId);
        if (messagePrompt == null || messagePrompt.finalPrompt == null) {
            this.messageBlock.innerHTML = `<span>No Message Prompt for message {mId}.</span>`;
            return;
        }

        let extra_tokens = 0;
        let cont_message = "";
        if (continue_generating) {
            cont_message = as_message_role(this.review.reviews[this.displaying].previous, "assistant");
            extra_tokens = count_tokens(this.review.reviews[this.displaying].previous);
        }

        let prompts = [];
        if (is_chat_completion()) {
            const pe = new PromptEngineeringChatComplete(mId, messagePrompt.rawPrompt, this.get_message_or_swipe(), this.metadata, this.advancedInfo);
            prompts = await pe.generate_review_prompt(messagePrompt, extra_tokens);
        } else {
            const pe = new PromptEngineeringTextComplete(mId, messagePrompt.finalPrompt + this.get_message_or_swipe(), this.metadata);
            const prompt = await pe.generate_review_prompt(messagePrompt, extra_tokens);
            prompts.push(as_message(prompt));
        }
        if (continue_generating) {
            prompts.push(cont_message)
        }
        let asyncGeneratorFunction = await context.ConnectionManagerRequestService.sendRequest(profile, prompts, this.metadata.num_predict,
            {stream: true, signal: abort.signal});
        asyncGenerator = asyncGeneratorFunction();

        let text = "";
        let reasoningTime = null;
        try {
            while (true) {
                let r = await asyncGenerator.next();
                if (r.done) {
                    asyncGenerator = null;
                    abort = null;
                    break;
                }

                const returnFromGenerator = r.value;
                const reasoning = returnFromGenerator.state?.reasoning;

                if (reasoning && reasoningTime === null) {
                    reasoningTime = performance.now();
                }

                text = returnFromGenerator.text;
                if (continue_generating) {
                    text = this.review.reviews[this.displaying].previous + text;
                }

                if (!text) {
                    this.review.reviews[this.displaying].metadata.reasoningTime = performance.now() - reasoningTime;
                } else {
                    this.review.reviews[this.displaying].metadata.reasoningDone = true;
                }

                this.review.reviews[this.displaying].text = text;
                this.review.reviews[this.displaying].metadata.reasoning = reasoning;
                this.display_review();
            }
        } catch (aborted) {
            if (aborted.cause && (aborted.cause !== "dialogClosed" && aborted.cause !== "userStopped"))
                return;
        }

        this.save();
        this.display_review();
        asyncGenerator = null;
    }
}

async function calculate_advanced_tokens(advancedInfo, mId) {
    if (advancedInfo.usePromptInfo)
        return "---";

    const metadata = initialize_request_metadata();
    const messagePrompt = get_message_prompts(mId);

    function get_message_or_swipe() {
        const message = SillyTavern.getContext().chat[mId];
        if (message.swipe_id) {
            return {
                mes: message.swipes[message.swipe_id],
                is_user: message.is_user
            };
        } else {
            return message;
        }
    }

    const pe = new PromptEngineeringChatComplete(mId, messagePrompt.rawPrompt, get_message_or_swipe(), metadata, advancedInfo);
    const prompts = await pe.generate_review_prompt(messagePrompt, null);
    return await count_tokens_async(prompts);
}

async function show_review(mId, advancedInfo = null) {

    // noinspection JSUnresolvedReference
    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'review'));
    // noinspection JSUnresolvedReference

    const popup = new Popup(template, POPUP_TYPE.DISPLAY, '',
        { wide: true, large: true, onOpen: async () => {

                // noinspection JSUnresolvedReference
                const messageBlock = $(document).find('#reviewer_review')[0];
                // noinspection JSUnresolvedReference
                const stopContinueButton = $(document).find('#reviewer_stopcontinue')[0];
                // noinspection JSUnresolvedReference
                const prev =  $(document).find('#reviewSwipesLeft')[0];
                // noinspection JSUnresolvedReference
                const next =  $(document).find('#reviewSwipesRight')[0];
                // noinspection JSUnresolvedReference
                const counter =  $(document).find('#reviewSwipes')[0];

                asyncGenerator = null;
                abort = null;
                let w = new ReviewWindow(mId, messageBlock, stopContinueButton, prev, next, counter);
                w.advancedInfo = advancedInfo;
                const r = w.get_review();
                if (!w.needs_generating) {
                    w.displaying = r.current;
                    w.display_review();
                    w.scroll_to_bottom();
                } else {
                    await w.generate_review(mId, false);
                }
            }, onClose: () => {
                if (asyncGenerator != null) {
                    abort.abort("dialogClosed");
                }
                update_message_visuals(mId);
            } });
    await popup.show();
}

async function show_advanced_modal(mId) {
    const template = $(await renderExtensionTemplateAsync(EXTENSION_PATH, 'advanced'));

    let existingAdvancedInfo = null;
    const reviewWithSwipes = get_data(context.chat[mId], "review");
    if (reviewWithSwipes) {
        let swipe = context.chat[mId].swipe_id || 0;
        const review = reviewWithSwipes[swipe];
        if (review && review.reviews && review.reviews[review.current]) {
            existingAdvancedInfo = review.reviews[review.current].metadata?.advancedInfo;
        }
    }

    const advancedInfo = Object.assign({
        prompt: get_settings("review_prompt") || "",
        usePromptInfo: true,
        persona: false,
        characters: false,
        worldinfo: false,
        scenario: false,
        tokenLimit: initialize_request_metadata().max_context_size,
        wiTrigger: 'review'
    }, existingAdvancedInfo || {});

    // Initialize values in elements
    template.find('#enerccio_reviewer_prompt_area').val(advancedInfo.prompt);
    template.find('#enerccio_reviewer_use_prompt_info').prop('checked', advancedInfo.usePromptInfo);
    template.find('#enerccio_reviewer_persona').prop('checked', advancedInfo.persona);
    template.find('#enerccio_reviewer_characters').prop('checked', advancedInfo.characters);
    template.find('#enerccio_reviewer_worldinfo').prop('checked', advancedInfo.worldinfo);
    template.find('#enerccio_reviewer_scenario').prop('checked', advancedInfo.scenario);
    template.find('#enerccio_reviewer_token_limit').val(advancedInfo.tokenLimit);
    template.find('#enerccio_reviewer_wi_trigger').val(advancedInfo.wiTrigger);

    const tokenLabel = template.find('#enerccio_reviewer_token_count_label');

    const updateAllAndTokens = async () => {
        // Collect current state into the pass-through dict
        advancedInfo.prompt = template.find('#enerccio_reviewer_prompt_area').val();
        advancedInfo.usePromptInfo = template.find('#enerccio_reviewer_use_prompt_info').is(':checked');
        advancedInfo.persona = template.find('#enerccio_reviewer_persona').is(':checked');
        advancedInfo.characters = template.find('#enerccio_reviewer_characters').is(':checked');
        advancedInfo.worldinfo = template.find('#enerccio_reviewer_worldinfo').is(':checked');
        advancedInfo.scenario = template.find('#enerccio_reviewer_scenario').is(':checked');
        advancedInfo.tokenLimit = Number(template.find('#enerccio_reviewer_token_limit').val());
        advancedInfo.wiTrigger = template.find('#enerccio_reviewer_wi_trigger').val();

        // Disabling behavior for Use prompt info
        const disabled = advancedInfo.usePromptInfo;
        template.find('#enerccio_reviewer_persona').prop('disabled', disabled);
        template.find('#enerccio_reviewer_characters').prop('disabled', disabled);
        template.find('#enerccio_reviewer_worldinfo').prop('disabled', disabled);
        template.find('#enerccio_reviewer_scenario').prop('disabled', disabled);
        template.find('#enerccio_reviewer_token_limit').prop('disabled', disabled);
        template.find('#enerccio_reviewer_wi_trigger').prop('disabled', disabled);

        // Call stub to calculate token count
        const count = await calculate_advanced_tokens(advancedInfo, mId);
        tokenLabel.text(`Token Count: ${count}`);
    };

    let typingTimer;
    const doneTypingInterval = 1000;

    // 1. Bind the debounced update listener to the textarea
    template.find('#enerccio_reviewer_prompt_area').on('input', () => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(updateAllAndTokens, doneTypingInterval);
    });

    // 2. Bind immediate update to checkboxes and dropdown selects (change only)
    template.find('input[type="checkbox"], select').on('change', async () => {
        clearTimeout(typingTimer);
        await updateAllAndTokens();
    });

    // 3. Bind debounced update to number inputs so typing doesn't stutter
    template.find('input[type="number"]').on('input', () => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(updateAllAndTokens, doneTypingInterval);
    });

    // Initial state run
    await updateAllAndTokens();

    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '', {
        wide: true,
        large: false,
        okButton: 'Generate',
        cancelButton: 'Close'
    });

    const result = await popup.show();
    if (result) {
        await show_review(mId, advancedInfo);
    }
}

function delete_review(mId) {
    const message = context.chat[mId];
    set_data(message, "review", null);
    update_message_visuals(mId);
}

const review_span_class = "review_span_class";
function update_message_visuals(i) {
    // Update the message visuals according to its current memory status
    // Each message div will have a div added to it with the memory for that message.
    // Even if there is no memory, I add the div because otherwise the spacing changes when the memory is added later.

    // div not found (message may not be loaded)
    let div_element = get_message_div(i);
    if (!div_element) {
        return;
    }

    // remove any existing added divs
    div_element.find(`span.${review_span_class}`).remove();

    let chat = getContext().chat;
    let message = chat[i];
    let review = get_data(message, 'review');
    if (!review)
        return;

    let character_div = div_element.find('div.mes_block');
    let inner_div = character_div.find('div').first().find('div').first().find('div').first();

    // noinspection JSUnresolvedReference
    let $span = $(`<span class="review_span_class">Has review</span>`);
    $span.on('click', async () => await show_review(i));
    inner_div.append($span);
}

function update_all_message_visuals() {
    // update the message visuals of each visible message, styled according to the inclusion criteria
    let chat = context.chat;
    // noinspection JSUnresolvedReference
    let first_displayed_message_id = Number($('#chat').children('.mes').first().attr('mesid'))
    for (let i=chat.length-1; i >= first_displayed_message_id; i--) {
        update_message_visuals(i, true);
    }
}

function update_advanced_button_visibility() {
    if (is_chat_completion()) {
        $(`.${advanced_button_class}`).show();
    } else {
        $(`.${advanced_button_class}`).hide();
    }
}

function initialize_message_buttons() {
    let html = `
        <div title="${t`Show/Generate review`}" class="mes_button ${show_button_class} fa-solid fa-star" tabindex="0"></div>
        <div title="${t`Advanced review options`}" class="mes_button ${advanced_button_class} fa-solid fa-cog" tabindex="0"></div>
        <div title="${t`Delete review`}" class="mes_button ${delete_button_class} fa-solid fa-star-half" tabindex="0"></div>
        `;

    // noinspection JSUnresolvedReference
    let $buttons = $("#message_template .mes_buttons .extraMesButtons");
    // noinspection JSUnresolvedReference
    $buttons.prepend(html);

    // noinspection JSUnresolvedReference
    $(document).on("click", `.${show_button_class}`, async function () {
        // noinspection JSUnresolvedReference
        const mesEl = $(this).closest('.mes');
        // noinspection JSUnresolvedReference
        const mesId = mesEl.attr('mesid');
        // noinspection JSUnresolvedReference
        let message_id = Number(mesId);  // get the message ID from the row's "message_id" attribute
        await show_review(message_id);
    });
    // noinspection JSUnresolvedReference
    $(document).on("click", `.${delete_button_class}`, function () {
        // noinspection JSUnresolvedReference
        const mesEl = $(this).closest('.mes');
        // noinspection JSUnresolvedReference
        const mesId = mesEl.attr('mesid');
        // noinspection JSUnresolvedReference
        let message_id = Number(mesId);  // get the message ID from the row's "message_id" attribute
        delete_review(message_id);
    });
    // noinspection JSUnresolvedReference
    $(document).on("click", `.${advanced_button_class}`, async function () {
        if (!is_chat_completion()) {
            return;
        }
        // noinspection JSUnresolvedReference
        const mesEl = $(this).closest('.mes');
        // noinspection JSUnresolvedReference
        const mesId = mesEl.attr('mesid');
        // noinspection JSUnresolvedReference
        let message_id = Number(mesId);
        await show_advanced_modal(message_id);
    });
}

// noinspection JSUnresolvedReference
jQuery(async function () {
    log(`Loading extension...`)

    await render_settings_menu();
    bind_setting('#profile', 'profile', 'text', () => load_profile(), false);
    bind_function('#save_profile', () => save_profile(), false);
    bind_function('#restore_profile', () => load_profile(), false);
    bind_function('#rename_profile', () => rename_profile(), false)
    bind_function('#new_profile', new_profile, false);
    bind_function('#delete_profile', delete_profile, false);

    bind_function('#character_profile', () => toggle_character_profile());
    bind_function('#chat_profile', () => toggle_chat_profile());
    bind_setting('#notify_on_profile_switch', 'notify_on_profile_switch', 'boolean');

    bind_function('#edit_review_prompt_pre', () => show_settings_prompt_pre());
    bind_function('#edit_review_prompt', () => show_settings_prompt());
    bind_setting('#remove_instruction', 'remove_instruction', 'boolean');
    bind_setting('#remove_user', 'remove_user', 'boolean');
    bind_setting('#remove_character', 'remove_character', 'boolean');
    bind_setting('#remove_world_info', 'remove_world_info', 'boolean');

    initialize_settings();
    initialize_message_buttons();
    update_advanced_button_visibility();

    context.eventSource.on(event_types.CHAT_CHANGED, (event) => {
        auto_load_profile();
        update_all_message_visuals();
        update_advanced_button_visibility();
    });

    context.eventSource.on('groupSelected', set_character_enabled_button_states);
    context.eventSource.on(event_types.GROUP_UPDATED, set_character_enabled_button_states);

    let update_events = [event_types.PRESET_CHANGED, event_types.CONNECTION_PROFILE_LOADED, event_types.CONNECTION_PROFILE_UPDATED]
    for (let event of update_events) {
        context.eventSource.on(event, () => {
            refresh_settings();
            update_advanced_button_visibility();
        });
    }

    update_all_message_visuals();
});
