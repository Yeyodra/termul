use super::*;

#[test]
fn every_family_has_a_generate_and_a_read_tool() {
    let tools = tools();
    assert_eq!(tools.len(), FAMILIES.len() * 2);
    for family in FAMILIES {
        let generate = format!("generate_{}", family.engine);
        let read = format!("get_{}_task", family.engine);
        assert!(
            tools.iter().any(|tool| tool.name == generate),
            "{generate} is listed"
        );
        assert!(
            tools.iter().any(|tool| tool.name == read),
            "{read} is listed"
        );
    }
}

#[test]
fn parse_tool_round_trips_every_listed_name() {
    for tool in tools() {
        let parsed = parse_tool(&tool.name);
        assert!(parsed.is_some(), "{} parses", tool.name);
        let (engine, call) = parsed.unwrap();
        let expected = if tool.name.starts_with("generate_") {
            Call::Generate
        } else {
            Call::Read
        };
        assert_eq!(call, expected, "{} has the right half", tool.name);
        assert!(
            tool.name.contains(engine),
            "{} names its engine {engine}",
            tool.name
        );
    }
}

#[test]
fn parse_tool_rejects_names_this_module_does_not_own() {
    for name in [
        "plan",
        "ask_user",
        "execute_luau",
        "create_node",
        "generate_",
        "get_task",
        "get_unknown_task",
        "generate_unknown"
    ] {
        assert!(parse_tool(name).is_none(), "{name} is not a generator tool");
    }
}

#[test]
fn every_tool_carries_the_description_tag() {
    for tool in tools() {
        let description = tool.description.as_deref().unwrap_or("");
        assert!(
            description.starts_with(DESCRIPTION_TAG),
            "{} carries the tag",
            tool.name
        );
    }
}

#[test]
fn the_generate_tools_accept_an_optional_prompt_and_spec() {
    for family in FAMILIES {
        let tool = generate_tool(family);
        let schema = &tool.input_schema;
        let properties = schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("properties");
        assert!(properties.contains_key("spec"), "{} takes a spec", tool.name);
        assert_eq!(
            properties.contains_key("prompt"),
            family.accepts_prompt,
            "{} prompt presence matches the family",
            tool.name
        );
    }
}

#[test]
fn a_family_with_a_kind_requires_it_as_a_top_level_argument() {
    for family in FAMILIES {
        let tool = generate_tool(family);
        let schema = &tool.input_schema;
        let required: Vec<String> = schema
            .get("required")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        match kind_field(family) {
            Some((field, values)) => {
                assert!(
                    required.contains(&field.to_string()),
                    "{} must require {field}: the validator reads it from the call, not the spec",
                    tool.name
                );
                let property = schema["properties"][field].clone();
                assert_eq!(property["type"], "string");
                let listed: Vec<String> = property["enum"]
                    .as_array()
                    .expect("enum")
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect();
                assert_eq!(listed, values, "{} enum matches the engine", tool.name);
                assert!(
                    tool.description.as_deref().unwrap_or("").contains(field),
                    "{} names {field} in its description too",
                    tool.name
                );
            }
            None => assert!(
                required.is_empty(),
                "{} requires nothing",
                tool.name
            ),
        }
    }
}

#[test]
fn the_clothing_type_enum_matches_the_renderer_validator() {
    let tool = generate_tool(&FAMILIES[0]);
    let listed: Vec<String> = tool.input_schema["properties"]["type"]["enum"]
        .as_array()
        .expect("enum")
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    assert_eq!(listed, vec!["shirt", "pants", "tshirt"]);
}

#[test]
fn the_read_tools_require_a_task_id() {
    for family in FAMILIES {
        let tool = task_tool(family);
        let required = tool
            .input_schema
            .get("required")
            .and_then(Value::as_array)
            .expect("required");
        assert_eq!(required.len(), 1, "{} requires one field", tool.name);
        assert_eq!(required[0], "task_id", "{} requires task_id", tool.name);
    }
}

#[test]
fn the_guide_names_every_tool_it_advertises() {
    let guide = instructions();
    for tool in tools() {
        assert!(guide.contains(&*tool.name), "the guide names {}", tool.name);
    }
}

#[test]
fn the_guide_forbids_the_file_fallback() {
    let guide = instructions();
    assert!(guide.contains("Do not write .lua files"));
}
