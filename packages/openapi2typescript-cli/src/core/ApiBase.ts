import {
    APIDescriptor,
    Type,
    isType,
    Schema,
    SchemaArray,
    SchemaObject,
    SchemaOrType,
    SchemaType,
    SchemaWithTypeName
} from './types/ApiDescriptor';
import { BufferType, Buffer } from './types/Buffer';
import assertNever from 'assert-never';

export interface Options {
    skipTypes: boolean;
    strict: boolean;
    explicitTypes: boolean;
    useFunctionTypeGenerator: boolean;
    schemasPrefix: string;
}

export class ApiBase {
    protected readonly api: APIDescriptor;
    protected readonly buffer: Buffer;
    protected readonly options: Options;
    private localBuffer: Array<string>;

    protected constructor(apiDescriptor: APIDescriptor, buffer: Buffer, options?: Partial<Options>) {
        this.api = apiDescriptor;
        this.buffer = buffer;
        this.options = {
            skipTypes: false,
            strict: true,
            explicitTypes: false,
            useFunctionTypeGenerator: true,
            schemasPrefix: '',
            ...options
        };
        this.localBuffer = [];
    }

    // Types related methods

    protected propertiesTypes(properties: Record<string, SchemaOrType>) {
        Object.entries(properties).forEach(([ key, schema ], index, array) => {
            this.appendTemp(`${key}`);
            if (schema.isOptional) {
                this.appendTemp('?');
            }

            this.appendTemp(': ');

            this.schemaTypes(schema);

            if (array.length !== index + 1) {
                this.appendTemp(',\n');
            }
        });
    }

    protected objectTypes(schema: SchemaObject) {
        if (schema.properties || schema.additionalProperties) {
            this.appendTemp('{\n');
            if (schema.properties) {
                this.propertiesTypes(schema.properties);
            }

            if (schema.properties && schema.additionalProperties) {
                this.appendTemp(', \n');
            }

            if (schema.additionalProperties) {
                this.appendTemp('[x: string]: ');
                this.schemaTypes(schema.additionalProperties);
                this.appendTemp('\n');
            }

            this.appendTemp('}\n');
        } else {
            this.appendTemp('unknown');
        }
    }

    protected arrayTypes(schema: SchemaArray) {
        this.appendTemp('Array<\n');
        this.schemaTypes(schema.items);
        this.appendTemp('>\n');
    }

    protected schemaTypes(schema: SchemaOrType, doNotUseModifiers?: boolean) {
        if (isType(schema)) {
            this.appendTemp(this.fullTypeName(schema));
        } else {
            switch (schema.type) {
                case SchemaType.ALL_OF:
                    if (schema.allOf.length) {
                        this.appendTemp('(');
                    }

                    schema.allOf.filter(schema => !this.isUnknown(schema)).forEach((localSchema, index, array) => {
                        this.schemaTypes(localSchema);
                        if (array.length !== index + 1) {
                            this.appendTemp('& ');
                        }
                    });

                    if (schema.allOf.length) {
                        this.appendTemp(')');
                    }

                    break;
                case SchemaType.ONE_OF:
                    this.appendTemp('(');
                    schema.oneOf.forEach((s, index, array) => {
                        this.schemaTypes(s);
                        if (array.length !== index + 1) {
                            this.appendTemp('| ');
                        }
                    });
                    this.appendTemp(')');
                    break;
                case SchemaType.ANY_OF:
                    schema.anyOf.forEach((s) => {
                        this.schemaTypes(s);

                        if (schema.anyOf.length > 1) {
                            this.appendTemp('& Partial<');
                        }

                        schema.anyOf.filter(v => v !== s).forEach((s2, index2, array2) => {
                            this.schemaTypes(s2);
                            if (array2.length !== index2 + 1) {
                                this.appendTemp('& ');
                            }
                        });

                        if (schema.anyOf.length > 1) {
                            this.appendTemp('> ');
                        }
                    });
                    break;
                case SchemaType.ENUM:
                    if (schema.enum.length > 0) {
                        this.appendTemp('(');
                    }

                    schema.enum.forEach((e, index, array) => {
                        this.appendTemp(`'${e}'`);
                        if (array.length !== index + 1) {
                            this.appendTemp('| ');
                        }
                    });

                    if (schema.enum.length > 0) {
                        this.appendTemp(')');
                    }

                    break;
                case SchemaType.ARRAY:
                    this.arrayTypes(schema);
                    break;
                case SchemaType.NUMBER:
                    this.appendTemp('number');
                    break;
                case SchemaType.INTEGER:
                    this.appendTemp('number');
                    break;
                case SchemaType.STRING:
                    this.appendTemp('string');
                    break;
                case SchemaType.BOOLEAN:
                    this.appendTemp('boolean');
                    break;
                case SchemaType.NULL:
                    this.appendTemp('null');
                    break;
                case SchemaType.OBJECT:
                    this.objectTypes(schema);
                    break;
                case SchemaType.UNKNOWN:
                    this.appendTemp('unknown');
                    break;
                default:
                    console.log(schema);
                    assertNever(schema);
            }
        }

        if (!doNotUseModifiers) {
            if (schema.isOptional) {
                this.appendTemp(' | undefined');
            }

            if (schema.isNullable) {
                this.appendTemp(' | null');
            }
        }
    }

    // Zod related methods

    protected properties(properties: Record<string, SchemaOrType>) {
        Object.entries(properties).forEach(([ key, schema ], index, array) => {
            this.appendTemp(`${key}: `);
            this.schema(schema);

            if (array.length !== index + 1) {
                this.appendTemp(',\n');
            }
        });
    }

    protected object(schema: SchemaObject) {
        if (schema.properties || schema.additionalProperties) {
            if (schema.properties && schema.additionalProperties) {
                this.appendTemp('z.union([\n');
            }

            if (schema.properties) {
                this.appendTemp('z.object({\n');
                this.properties(schema.properties);
                this.appendTemp('})\n');
                if (!this.options.strict) {
                    this.appendTemp('.nonstrict()');
                }
            }

            if (schema.properties && schema.additionalProperties) {
                this.appendTemp(', \n');
            }

            if (schema.additionalProperties) {
                this.appendTemp('z.record(\n');
                this.schema(schema.additionalProperties);
                this.appendTemp(')\n');
            }

            if (schema.properties && schema.additionalProperties) {
                this.appendTemp('])\n');
            }
        } else {
            this.appendTemp('z.unknown()');
        }
    }

    protected array(schema: SchemaArray) {
        this.appendTemp('z.array(\n');
        this.schema(schema.items);
        this.appendTemp(')\n');
    }

    protected schema(schema: SchemaOrType, doNotUseModifiers?: boolean) {
        if (isType(schema)) {
            if (schema.hasLoop) {
                this.appendTemp('z.lazy(() => ');
            }

            // This allows to use an schema that hasn't been defined yet
            if (this.options.useFunctionTypeGenerator) {
                this.appendTemp(`${this.functionName(schema)}()`);
            } else {
                this.appendTemp(this.fullTypeName(schema));
            }

            if (schema.hasLoop) {
                this.appendTemp(')');
            }
        } else {
            switch (schema.type) {
                case SchemaType.ALL_OF:
                    let open = 0;
                    schema.allOf.filter(schema => !this.isUnknown(schema)).forEach((localSchema, index, array) => {
                        if (open > 0) {
                            this.appendTemp(',\n');
                        }

                        if (array.length !== index + 1) {
                            ++open;
                            // Todo: Intersection is not the proper zod-way to do it. Need to change to schema.merge() to chain all the objects.
                            this.appendTemp('z.intersection(\n');
                        }

                        this.schema(localSchema);
                    });
                    for (let i = 0;i < open; ++i) {
                        this.appendTemp(')');
                    }

                    break;
                case SchemaType.ONE_OF:
                    this.appendTemp('z.union([');
                    schema.oneOf.forEach((s, index, array) => {
                        this.schema(s);
                        if (array.length !== index + 1) {
                            this.appendTemp(', ');
                        }
                    });
                    this.appendTemp('])');
                    break;
                case SchemaType.ANY_OF:
                    // Todo: revisit this case, is more complex than just unions
                    // Any_of [A, B, C] => A & Optional(B & C) | B & Optional (A & C) | C & Optional (A & B)
                    // i.e. at least one, but can have everything
                    this.appendTemp('z.union([');
                    schema.anyOf.forEach((s, index, array) => {
                        this.schema(s);
                        if (array.length !== index + 1) {
                            this.appendTemp(', ');
                        }
                    });
                    this.appendTemp('])');
                    break;
                case SchemaType.ENUM:
                    this.appendTemp('z.enum([\n');
                    schema.enum.forEach((e, index, array) => {
                        this.appendTemp(`'${e}'`);
                        if (array.length !== index + 1) {
                            this.appendTemp(',\n');
                        }
                    });
                    this.appendTemp('])\n');
                    break;
                case SchemaType.ARRAY:
                    this.array(schema);
                    break;
                case SchemaType.NUMBER:
                    this.appendTemp('z.number()');
                    break;
                case SchemaType.INTEGER:
                    this.appendTemp('z.number().int()');
                    break;
                case SchemaType.STRING:
                    this.appendTemp('z.string()');
                    if (schema.maxLength !== undefined) {
                        this.appendTemp(`.max(${schema.maxLength})`);
                    }

                    break;
                case SchemaType.BOOLEAN:
                    this.appendTemp('z.boolean()');
                    break;
                case SchemaType.NULL:
                    this.appendTemp('z.null()');
                    break;
                case SchemaType.OBJECT:
                    this.object(schema);
                    break;
                case SchemaType.UNKNOWN:
                    this.appendTemp('z.unknown()');
                    break;
                default:
                    console.log(schema);
                    assertNever(schema);
            }
        }

        if (!doNotUseModifiers) {
            if (schema.isOptional) {
                this.appendTemp('.optional()');
            }

            if (schema.isNullable) {
                this.appendTemp('.nullable()');
            }
        }
    }

    protected appendTemp(...lines: Array<string>) {
        for (const line of lines) {
            this.localBuffer.push(line);
        }
    }

    protected writeTempToBuffer(type: BufferType) {
        this.buffer.write(this.localBuffer.join(''), type);
        this.localBuffer = [];
    }

    protected functionName(type: Type<Schema> | SchemaWithTypeName) {
        return `zodSchema${type.typeName}`;
    }

    protected  fullTypeName(schema: Type<Schema>) {
        return `${this.options.schemasPrefix}${schema.typeName}`;
    }

    protected isUnknown(schemaOrType: SchemaOrType): boolean {
        if (isType(schemaOrType)) {
            return this.isUnknown(schemaOrType.referred);
        } else {
            return schemaOrType.type === SchemaType.UNKNOWN;
        }
    }
}
